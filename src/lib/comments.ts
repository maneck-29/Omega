/**
 * Comment service — threading, sorting, edit/delete, moderation.
 *
 * Threading uses an adjacency list (`parentCommentId`). All comments for a post
 * are fetched in one query and the tree is assembled in memory: simple, one
 * round-trip, and fine up to roughly a thousand comments per post. Recursive
 * CTEs or a closure table are the escalation path if that ceiling is ever hit —
 * not before it is measured.
 */

import { getUsersByIds } from "./auth";
import { getRepository } from "./db";
import { badRequest, forbidden, notFound } from "./errors";
import { canModifyComment, assertModerator, assertNotBanned } from "./permissions";
import { getScoreProvider } from "./scores";
import type {
  Comment,
  CommentId,
  CommentNode,
  CommentSort,
  PublicUser,
  Score,
  SubredditId,
  UserId,
} from "./types";
import { validateCommentBody } from "./validation";

/** Reddit-style cap; deeper replies sit behind a "continue thread" link. */
export const MAX_RENDER_DEPTH = 8;

export const TOMBSTONE_BODY = "[deleted]";
export const REMOVED_BODY = "[removed]";

function isTombstoned(comment: Comment): boolean {
  return comment.deletedAt !== null || comment.removedAt !== null;
}

/**
 * Replaces bodies of tombstoned comments before they leave the server.
 *
 * The row is kept so replies stay reachable, but the text must not be sent to
 * clients — that would leak deleted and mod-removed content.
 */
function redact(comment: Comment): Comment {
  if (comment.deletedAt) return { ...comment, body: TOMBSTONE_BODY };
  if (comment.removedAt) return { ...comment, body: REMOVED_BODY };
  return comment;
}

function sortSiblings(
  nodes: CommentNode[],
  sort: CommentSort,
  scores: Map<string, Score>,
): CommentNode[] {
  const scoreOf = (node: CommentNode) =>
    scores.get(node.comment.id)?.score ?? 0;

  const byNewest = (a: CommentNode, b: CommentNode) =>
    b.comment.createdAt.localeCompare(a.comment.createdAt);

  switch (sort) {
    case "new":
      return nodes.sort(byNewest);
    case "old":
      return nodes.sort((a, b) =>
        a.comment.createdAt.localeCompare(b.comment.createdAt),
      );
    case "top":
    case "best":
      // Newest wins ties, so a fresh comment is not buried behind older zeros.
      return nodes.sort((a, b) => scoreOf(b) - scoreOf(a) || byNewest(a, b));
    case "controversial": {
      // Most total votes with the narrowest margin first.
      const controversy = (node: CommentNode) => {
        const s = scores.get(node.comment.id);
        if (!s) return 0;
        const total = s.upvotes + s.downvotes;
        if (total === 0) return 0;
        return total / (Math.abs(s.score) + 1);
      };
      return nodes.sort((a, b) => controversy(b) - controversy(a) || byNewest(a, b));
    }
  }
}

/**
 * Builds the comment forest for a post.
 *
 * `rootId` renders a subtree ("continue this thread"). Depth is measured from
 * that root so the cap applies per view rather than absolutely.
 */
export async function getCommentTree(
  postId: string,
  options: {
    viewerId?: UserId | null;
    sort?: CommentSort;
    rootId?: CommentId | null;
    maxDepth?: number;
  } = {},
): Promise<{ nodes: CommentNode[]; total: number }> {
  const {
    viewerId = null,
    sort = "best",
    rootId = null,
    maxDepth = MAX_RENDER_DEPTH,
  } = options;

  const repo = getRepository();
  const comments = await repo.listCommentsByPost(postId);

  if (comments.length === 0) return { nodes: [], total: 0 };

  const [authors, scores] = await Promise.all([
    getUsersByIds([...new Set(comments.map((c) => c.authorId))]),
    getScoreProvider().getScores(
      "comment",
      comments.map((c) => c.id),
      viewerId,
    ),
  ]);

  const childrenByParent = new Map<CommentId | null, Comment[]>();
  for (const comment of comments) {
    const siblings = childrenByParent.get(comment.parentCommentId) ?? [];
    siblings.push(comment);
    childrenByParent.set(comment.parentCommentId, siblings);
  }

  const build = (parentId: CommentId | null, depth: number): CommentNode[] => {
    const children = childrenByParent.get(parentId) ?? [];

    const nodes = children.map<CommentNode>((comment) => {
      const tombstoned = isTombstoned(comment);
      const atCap = depth >= maxDepth;
      const replies = atCap ? [] : build(comment.id, depth + 1);

      return {
        comment: redact(comment),
        author: tombstoned
          ? null
          : (authors.get(comment.authorId) as PublicUser | undefined) ?? null,
        score: scores.get(comment.id) ?? null,
        depth,
        replies,
        hasMoreReplies:
          atCap && (childrenByParent.get(comment.id) ?? []).length > 0,
        isTombstone: tombstoned,
      };
    });

    return sortSiblings(nodes, sort, scores);
  };

  // A subtree view starts at the root comment itself, not its children.
  if (rootId) {
    const root = comments.find((c) => c.id === rootId);
    if (!root) throw notFound("Comment not found", "comment_not_found");
    const [node] = build(root.parentCommentId, 0).filter(
      (n) => n.comment.id === rootId,
    );
    return { nodes: node ? [node] : [], total: comments.length };
  }

  return { nodes: build(null, 0), total: comments.length };
}

/**
 * Creates a comment or reply.
 *
 * `subredditId` is required for the ban check — comments inherit moderation from
 * the subreddit the post lives in.
 */
export async function createComment(input: {
  postId: string;
  subredditId: SubredditId;
  parentCommentId?: CommentId | null;
  authorId: UserId;
  body: unknown;
}): Promise<Comment> {
  const repo = getRepository();
  const body = validateCommentBody(input.body);

  await assertNotBanned(input.authorId, input.subredditId);

  const parentCommentId = input.parentCommentId ?? null;

  if (parentCommentId) {
    const parent = await repo.getCommentById(parentCommentId);
    if (!parent) {
      throw notFound("Parent comment not found", "parent_not_found");
    }
    // Guards against a reply being grafted onto another post's thread.
    if (parent.postId !== input.postId) {
      throw badRequest(
        "Parent comment belongs to a different post",
        "parent_post_mismatch",
      );
    }
    // Replying under a mod-removed comment would resurrect the subtree.
    if (parent.removedAt) {
      throw forbidden("Cannot reply to a removed comment", "parent_removed");
    }
  }

  return repo.createComment({
    postId: input.postId,
    parentCommentId,
    authorId: input.authorId,
    body,
  });
}

export async function editComment(input: {
  commentId: CommentId;
  actorId: UserId;
  body: unknown;
}): Promise<Comment> {
  const repo = getRepository();
  const comment = await repo.getCommentById(input.commentId);
  if (!comment) throw notFound("Comment not found", "comment_not_found");

  // Only the author edits content; moderators remove rather than rewrite.
  if (comment.authorId !== input.actorId) {
    throw forbidden("You can only edit your own comments", "not_author");
  }
  if (isTombstoned(comment)) {
    throw forbidden("Cannot edit a deleted comment", "comment_deleted");
  }

  return repo.updateCommentBody(input.commentId, validateCommentBody(input.body));
}

/**
 * Author deletion. Soft delete only — the row survives as a tombstone so replies
 * beneath it remain reachable.
 */
export async function deleteComment(input: {
  commentId: CommentId;
  actorId: UserId;
  subredditId: SubredditId;
}): Promise<Comment> {
  const repo = getRepository();
  const comment = await repo.getCommentById(input.commentId);
  if (!comment) throw notFound("Comment not found", "comment_not_found");

  const allowed = await canModifyComment(
    input.actorId,
    comment.authorId,
    input.subredditId,
  );
  if (!allowed) {
    throw forbidden("You cannot delete this comment", "not_author_or_mod");
  }

  return repo.softDeleteComment(input.commentId);
}

/** Moderator removal, tracked separately from author deletion and logged. */
export async function setCommentRemoved(input: {
  commentId: CommentId;
  actorId: UserId;
  subredditId: SubredditId;
  removed: boolean;
  reason?: string | null;
}): Promise<Comment> {
  const repo = getRepository();
  await assertModerator(input.actorId, input.subredditId);

  const comment = await repo.getCommentById(input.commentId);
  if (!comment) throw notFound("Comment not found", "comment_not_found");

  const updated = await repo.setCommentRemoved(
    input.commentId,
    input.removed ? input.actorId : null,
  );

  await repo.addModLogEntry({
    subredditId: input.subredditId,
    moderatorId: input.actorId,
    action: input.removed ? "remove_comment" : "approve_comment",
    targetType: "comment",
    targetId: input.commentId,
    reason: input.reason ?? null,
  });

  return updated;
}

/**
 * Visible comment count for a post.
 *
 * The canonical counter belongs on TM2's `posts` table; this is the source of
 * truth TM3 exposes until that column exists.
 */
export async function getCommentCount(postId: string): Promise<number> {
  return getRepository().countCommentsByPost(postId);
}

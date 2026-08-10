/**
 * /api/posts/[id]
 *
 *   GET    read a single post
 *   PATCH  edit a post you own
 *   DELETE soft-delete a post you own
 *
 * Ownership is enforced in the data layer against the owner token or, once
 * accounts exist, the user id. In this Next.js version `params` is a Promise.
 */

import { NextResponse } from "next/server";
import { ensureIdentity, readIdentity } from "@/lib/identity";
import { errorResponse, readJson } from "@/lib/http";
import { deletePost, getPost, updatePost, NotFoundError } from "@/lib/posts";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: Context) {
  try {
    const { id } = await context.params;
    const identity = await readIdentity();
    const post = await getPost(identity, id);

    if (!post) throw new NotFoundError("That post no longer exists");
    return NextResponse.json({ post });
  } catch (cause) {
    return errorResponse(cause);
  }
}

export async function PATCH(request: Request, context: Context) {
  try {
    const { id } = await context.params;
    const body = await readJson(request);
    const identity = await ensureIdentity();

    const post = await updatePost(identity, id, {
      body: typeof body.body === "string" ? body.body : undefined,
      url: typeof body.url === "string" ? body.url : undefined,
      imageUrl: typeof body.imageUrl === "string" ? body.imageUrl : undefined,
    });

    return NextResponse.json({ post });
  } catch (cause) {
    return errorResponse(cause);
  }
}

export async function DELETE(_request: Request, context: Context) {
  try {
    const { id } = await context.params;
    const identity = await ensureIdentity();
    await deletePost(identity, id);
    return NextResponse.json({ ok: true });
  } catch (cause) {
    return errorResponse(cause);
  }
}

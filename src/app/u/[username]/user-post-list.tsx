"use client";

import { useState } from "react";
import PostCard from "@/components/post-card";
import type { PostView } from "@/lib/types";

export default function UserPostList({
  initialPosts,
}: {
  initialPosts: PostView[];
}) {
  const [posts, setPosts] = useState(initialPosts);

  function handleDeleted(id: string) {
    setPosts((prev) => prev.filter((p) => p.post.id !== id));
  }

  if (posts.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-zinc-500">No posts yet.</p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {posts.map((postView) => (
        <PostCard key={postView.post.id} view={postView} onDeleted={handleDeleted} />
      ))}
    </div>
  );
}

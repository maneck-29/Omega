import CreateSubredditForm from "@/components/create-subreddit-form";

export default function CreateSubredditPage() {
  return (
    <div className="mx-auto flex w-full max-w-lg flex-1 flex-col gap-6 px-6 py-10">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">
          Create a community
        </h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          You become its first moderator and member.
        </p>
      </header>
      <CreateSubredditForm />
    </div>
  );
}

import AddItemForm from "./add-item-form";
import { listItems } from "@/lib/items";

// Read on every request so newly created items show up after router.refresh().
export const dynamic = "force-dynamic";

export default function Home() {
  const items = listItems();

  return (
    <div className="flex flex-1 flex-col items-center bg-zinc-50 font-sans dark:bg-black">
      <main className="flex w-full max-w-2xl flex-1 flex-col gap-10 px-6 py-20">
        <header className="flex flex-col gap-2">
          <h1 className="text-3xl font-semibold tracking-tight">Hot Takes</h1>
          <p className="text-zinc-600 dark:text-zinc-400">
            Next.js App Router with API route handlers and Tailwind CSS.
          </p>
        </header>

        <section className="flex flex-col gap-4">
          <h2 className="text-sm font-medium uppercase tracking-wide text-zinc-500">
            Items
          </h2>
          <AddItemForm />
          <ul className="flex flex-col divide-y divide-black/[.06] rounded-lg border border-black/[.08] dark:divide-white/[.08] dark:border-white/[.12]">
            {items.length === 0 ? (
              <li className="px-4 py-3 text-sm text-zinc-500">No items yet.</li>
            ) : (
              items.map((item) => (
                <li
                  key={item.id}
                  className="flex items-center justify-between gap-4 px-4 py-3"
                >
                  <span className="text-sm">{item.name}</span>
                  <time
                    dateTime={item.createdAt}
                    className="font-mono text-xs text-zinc-500"
                  >
                    {item.createdAt.slice(0, 10)}
                  </time>
                </li>
              ))
            )}
          </ul>
        </section>

        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-medium uppercase tracking-wide text-zinc-500">
            API
          </h2>
          <ul className="flex flex-col gap-2 font-mono text-sm text-zinc-600 dark:text-zinc-400">
            <li>GET /api/health</li>
            <li>GET /api/items</li>
            <li>POST /api/items</li>
          </ul>
        </section>
      </main>
    </div>
  );
}

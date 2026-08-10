export type Item = {
  id: string;
  name: string;
  createdAt: string;
};

// In-memory store. Swap for a real database when one is wired up; module state
// does not survive a server restart and is not shared across instances.
const items: Item[] = [
  { id: "1", name: "First item", createdAt: new Date(0).toISOString() },
];

export function listItems(): Item[] {
  return items;
}

export function createItem(name: string): Item {
  const item: Item = {
    id: crypto.randomUUID(),
    name,
    createdAt: new Date().toISOString(),
  };
  items.push(item);
  return item;
}

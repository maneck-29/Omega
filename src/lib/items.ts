import { auroraDSQLPostgres } from "@aws/aurora-dsql-postgresjs-connector";

export type Item = {
  id: string;
  name: string;
  createdAt: string;
};

const sql = auroraDSQLPostgres({
  host: process.env.PGHOST!,
  database: process.env.PGDATABASE || "postgres",
  username: process.env.PGUSER || "admin",
});

export async function listItems(): Promise<Item[]> {
  const rows = await sql`
    SELECT id, name, created_at FROM items ORDER BY created_at DESC
  `;
  return rows.map((row) => ({
    id: row.id as string,
    name: row.name as string,
    createdAt: (row.created_at as Date).toISOString(),
  }));
}

export async function createItem(name: string): Promise<Item> {
  const id = crypto.randomUUID();
  const [row] = await sql`
    INSERT INTO items (id, name) VALUES (${id}, ${name})
    RETURNING id, name, created_at
  `;
  return {
    id: row.id as string,
    name: row.name as string,
    createdAt: (row.created_at as Date).toISOString(),
  };
}

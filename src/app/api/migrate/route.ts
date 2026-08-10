import { auroraDSQLPostgres } from "@aws/aurora-dsql-postgresjs-connector";

export async function POST() {
  try {
    const sql = auroraDSQLPostgres({
      host: process.env.PGHOST!,
      database: process.env.PGDATABASE || "postgres",
      username: process.env.DSQL_ADMIN_USER || "admin",
    });

    await sql`
      CREATE TABLE IF NOT EXISTS items (
        id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
        name TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `;

    const appUser = process.env.PGUSER || "omega_user_items_db";
    await sql`GRANT ALL ON TABLE items TO ${sql.unsafe(appUser)}`;

    await sql.end();

    return Response.json({ success: true, message: "Migration complete" });
  } catch (error) {
    console.error("Migration error:", error);
    return Response.json(
      { error: error instanceof Error ? error.message : "Migration failed" },
      { status: 500 }
    );
  }
}

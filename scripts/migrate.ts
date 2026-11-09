import { Pool } from "pg";
import { readdir, readFile } from "node:fs/promises";
try {
  process.loadEnvFile(new URL("../.env", import.meta.url));
} catch {}
export async function migrate(databaseUrl: string) {
  const pool = new Pool({ connectionString: databaseUrl }),
    db = await pool.connect();
  try {
    await db.query("BEGIN");
    await db.query("SELECT pg_advisory_xact_lock(77332001)");
    await db.query(
      "CREATE TABLE IF NOT EXISTS schema_migrations(version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())",
    );
    const directory = new URL("../apps/api/migrations/", import.meta.url);
    for (const file of (await readdir(directory))
      .filter((f) => f.endsWith(".sql"))
      .sort()) {
      if (
        (
          await db.query("SELECT 1 FROM schema_migrations WHERE version=$1", [
            file,
          ])
        ).rowCount
      )
        continue;
      await db.query(await readFile(new URL(file, directory), "utf8"));
      await db.query("INSERT INTO schema_migrations(version) VALUES($1)", [
        file,
      ]);
    }
    await db.query("COMMIT");
  } catch (e) {
    await db.query("ROLLBACK");
    throw e;
  } finally {
    db.release();
    await pool.end();
  }
}
if (process.argv[1]?.endsWith("migrate.ts")) {
  if (!process.env.DATABASE_URL) throw Error("DATABASE_URL required");
  await migrate(process.env.DATABASE_URL);
  console.log("PostgreSQL migrations applied");
}

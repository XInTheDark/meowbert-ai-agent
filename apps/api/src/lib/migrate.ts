import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";

/**
 * Connect to the default "postgres" database and CREATE the target database
 * if it doesn't already exist. This avoids a FATAL 3D000 on first run.
 */
export async function ensureDatabase(
  connectionString: string,
  options: { allowCreate?: boolean } = {}
): Promise<void> {
  const allowCreate = options.allowCreate ?? true;
  const parsed = new URL(connectionString);
  const dbName = decodeURIComponent(parsed.pathname.replace(/^\/+/, ""));
  if (!dbName) return;

  // Connect to the maintenance database instead of the target
  parsed.pathname = "/postgres";
  const adminPool = new Pool({ connectionString: parsed.toString() });
  try {
    console.log(`[startup] Checking if database "${dbName}" exists…`);
    const result = await adminPool.query(
      "SELECT 1 FROM pg_database WHERE datname = $1",
      [dbName]
    );
    if (result.rowCount === 0) {
      if (!allowCreate) {
        throw new Error(
          `[startup] Database "${dbName}" does not exist and startup auto-create is disabled. ` +
            "Refusing to create a fresh database to avoid accidental data loss."
        );
      }
      const escaped = dbName.replace(/"/g, '""');
      await adminPool.query(`CREATE DATABASE "${escaped}"`);
      console.log(`[startup] Created database "${dbName}"`);
    } else {
      console.log(`[startup] Database "${dbName}" already exists`);
    }
  } catch (error) {
    console.error(`[startup] ensureDatabase failed for "${dbName}":`, error);
    throw error;
  } finally {
    await adminPool.end();
  }
}

export async function runMigrations(pool: Pool): Promise<void> {
  const currentFile = fileURLToPath(import.meta.url);
  const root = path.resolve(path.dirname(currentFile), "../../../../");
  const migrationDir = path.resolve(root, "db/migrations");

  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);

  const appliedRows = await pool.query<{ id: string }>("SELECT id FROM schema_migrations");
  const applied = new Set(appliedRows.rows.map((row) => row.id));

  const files = (await fs.readdir(migrationDir)).filter((name) => name.endsWith(".sql")).sort();

  for (const file of files) {
    if (applied.has(file)) {
      continue;
    }

    const sql = await fs.readFile(path.join(migrationDir, file), "utf8");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query("INSERT INTO schema_migrations (id) VALUES ($1)", [file]);
      await client.query("COMMIT");
      console.log(`Applied migration: ${file}`);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}

export async function assertSchemaMigrationsTableExists(pool: Pool): Promise<void> {
  const result = await pool.query<{ schema_table: string | null }>(
    "SELECT to_regclass('public.schema_migrations') AS schema_table"
  );
  const relation = result.rows[0]?.schema_table ?? null;
  if (relation) {
    return;
  }

  throw new Error(
    '[startup] Required table "schema_migrations" is missing. ' +
      "This usually means the Postgres data directory is empty or points to a different volume path. " +
      "Refusing startup to avoid silently creating a fresh schema. " +
      "For the very first bootstrap only, set MEOWBERT_DB_REQUIRE_EXISTING_SCHEMA=false."
  );
}

import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { Pool, PoolClient } from "pg";

const migrationsDirectory = fileURLToPath(
  new URL("../../../db/migrations/", import.meta.url),
);
const advisoryLockId = 7_228_291_461;

type Migration = {
  name: string;
  upPath: string;
  downPath: string;
};

async function loadMigrations(): Promise<Migration[]> {
  const filenames = await readdir(migrationsDirectory);
  const upFiles = filenames
    .filter((filename) => filename.endsWith(".up.sql"))
    .sort();

  return upFiles.map((filename) => {
    const name = filename.slice(0, -".up.sql".length);
    return {
      name,
      upPath: `${migrationsDirectory}/${filename}`,
      downPath: `${migrationsDirectory}/${name}.down.sql`,
    };
  });
}

async function initializeMigrationTable(client: PoolClient): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS public.aggregator_schema_migrations (
      name text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);
}

async function withMigrationLock<T>(
  pool: Pool,
  operation: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock($1)", [advisoryLockId]);
    await initializeMigrationTable(client);
    return await operation(client);
  } finally {
    await client
      .query("SELECT pg_advisory_unlock($1)", [advisoryLockId])
      .catch(() => {
        // The session will release the lock when the connection closes.
      });
    client.release();
  }
}

export async function migrateToLatest(pool: Pool): Promise<string[]> {
  return withMigrationLock(pool, async (client) => {
    const migrations = await loadMigrations();
    const appliedResult = await client.query<{ name: string }>(
      "SELECT name FROM public.aggregator_schema_migrations",
    );
    const applied = new Set(appliedResult.rows.map(({ name }) => name));
    const newlyApplied: string[] = [];

    for (const migration of migrations) {
      if (applied.has(migration.name)) {
        continue;
      }

      const sql = await readFile(migration.upPath, "utf8");
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query(
          "INSERT INTO public.aggregator_schema_migrations (name) VALUES ($1)",
          [migration.name],
        );
        await client.query("COMMIT");
        newlyApplied.push(migration.name);
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }

    return newlyApplied;
  });
}

export async function rollbackAllForDevelopment(
  pool: Pool,
  options: { confirmDestructive: boolean },
): Promise<string[]> {
  if (process.env.NODE_ENV === "production" || !options.confirmDestructive) {
    throw new Error(
      "Rollback is restricted to non-production environments and requires " +
        "explicit destructive confirmation.",
    );
  }

  return withMigrationLock(pool, async (client) => {
    const migrations = await loadMigrations();
    const appliedResult = await client.query<{ name: string }>(
      "SELECT name FROM public.aggregator_schema_migrations ORDER BY applied_at DESC",
    );
    const migrationByName = new Map(
      migrations.map((migration) => [migration.name, migration]),
    );
    const rolledBack: string[] = [];

    for (const { name } of appliedResult.rows) {
      const migration = migrationByName.get(name);
      if (migration === undefined) {
        throw new Error(`Missing rollback file for applied migration: ${name}`);
      }

      const sql = await readFile(migration.downPath, "utf8");
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query(
          "DELETE FROM public.aggregator_schema_migrations WHERE name = $1",
          [name],
        );
        await client.query("COMMIT");
        rolledBack.push(name);
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }

    return rolledBack;
  });
}

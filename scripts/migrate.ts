import { existsSync } from "node:fs";
import { resolve } from "node:path";
import {
  createDatabasePool,
  migrateToLatest,
  rollbackAllForDevelopment,
} from "../packages/database/src/index.js";

const envFile = resolve(".env");
if (existsSync(envFile)) {
  process.loadEnvFile(envFile);
}

const connectionString = process.env.DATABASE_URL;
if (connectionString === undefined || connectionString.length === 0) {
  throw new Error("DATABASE_URL is required to run database migrations.");
}

const command = process.argv[2] ?? "up";
const pool = createDatabasePool(connectionString, { max: 1 });

try {
  if (command === "up") {
    const applied = await migrateToLatest(pool);
    console.log(
      applied.length === 0
        ? "Database is already at the latest migration."
        : `Applied migrations: ${applied.join(", ")}`,
    );
  } else if (command === "down:all") {
    const rolledBack = await rollbackAllForDevelopment(pool, {
      confirmDestructive: process.env.ALLOW_DESTRUCTIVE_ROLLBACK === "true",
    });
    console.log(
      rolledBack.length === 0
        ? "No migrations were applied."
        : `Rolled back migrations: ${rolledBack.join(", ")}`,
    );
  } else {
    throw new Error(`Unknown migration command: ${command}`);
  }
} finally {
  await pool.end();
}

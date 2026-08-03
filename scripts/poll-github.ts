import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { createDatabasePool } from "../packages/database/src/index.js";
import {
  loadGithubSourcesFromFile,
  pollGithubSource,
} from "../packages/github/src/index.js";

const envFile = resolve(".env");
if (existsSync(envFile)) {
  process.loadEnvFile(envFile);
}

const connectionString = process.env.DATABASE_URL;
if (connectionString === undefined || connectionString.length === 0) {
  throw new Error("DATABASE_URL is required.");
}

const sourcesPath = resolve(
  process.env.SOURCES_CONFIG_PATH ?? "config/sources.example.yaml",
);
const sourceIdIndex = process.argv.indexOf("--source-id");
const sourceId =
  sourceIdIndex >= 0 ? process.argv[sourceIdIndex + 1] : undefined;
const pool = createDatabasePool(connectionString);

try {
  const sources = await loadGithubSourcesFromFile(sourcesPath);
  const selected =
    sourceId === undefined
      ? sources.filter((source) => source.enabled)
      : sources.filter((source) => source.id === sourceId);
  for (const source of selected) {
    const results = await pollGithubSource({
      pool,
      source,
      token: process.env.GITHUB_TOKEN?.trim() || null,
      jitterMaxMs: 0,
    });
    for (const result of results) {
      console.log(JSON.stringify(result));
    }
  }
} finally {
  await pool.end();
}

import { createDatabasePool } from "../packages/database/src/index.js";
import { GeminiStructuredExtractionProvider } from "../packages/extraction/src/index.js";
import {
  DEFAULT_AUTO_PUBLISH_CONFIDENCE,
  DEFAULT_FEED_DESTINATION_KEY,
  processEventBatch,
} from "../packages/processing/src/index.js";

function readFlag(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index < 0) {
    return undefined;
  }
  return process.argv[index + 1];
}

const connectionString = process.env.DATABASE_URL;
if (connectionString === undefined || connectionString.length === 0) {
  throw new Error("DATABASE_URL is required.");
}

const limit = Number(readFlag("--limit") ?? "1");
const apiKey = process.env.GEMINI_API_KEY;
const pool = createDatabasePool(connectionString);

try {
  const results = await processEventBatch(pool, {
    limit: Number.isFinite(limit) ? limit : 1,
    provider:
      apiKey === undefined || apiKey.length === 0
        ? null
        : new GeminiStructuredExtractionProvider({ apiKey }),
    destinationKey:
      process.env.FEED_DESTINATION_KEY ?? DEFAULT_FEED_DESTINATION_KEY,
    minimumAutoPublishConfidence: Number(
      process.env.AUTO_PUBLISH_CONFIDENCE ?? DEFAULT_AUTO_PUBLISH_CONFIDENCE,
    ),
    resolveRedirects: process.env.RESOLVE_REDIRECTS === "true",
  });

  for (const result of results) {
    console.log(JSON.stringify(result));
  }
} finally {
  await pool.end();
}

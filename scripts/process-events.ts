import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { createDatabasePool } from "../packages/database/src/index.js";
import {
  OPPORTUNITY_DUPLICATE_REACTION,
  requestBotMessageReaction,
} from "../packages/discord/src/index.js";
import { GeminiStructuredExtractionProvider } from "../packages/extraction/src/index.js";
import {
  DEFAULT_AUTO_PUBLISH_CONFIDENCE,
  DEFAULT_FEED_DESTINATION_KEY,
  processEventBatch,
  type ProcessNextEventOptions,
} from "../packages/processing/src/index.js";

const envFile = resolve(".env");
if (existsSync(envFile)) {
  process.loadEnvFile(envFile);
}

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
const discordBotUrl = process.env.DISCORD_BOT_URL?.trim();
const defaultIntakeChannelId =
  process.env.DISCORD_INTAKE_CHANNEL_ID?.trim() || undefined;

const options: ProcessNextEventOptions = {
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
};

if (defaultIntakeChannelId !== undefined) {
  options.defaultIntakeChannelId = defaultIntakeChannelId;
}
if (discordBotUrl !== undefined && discordBotUrl.length > 0) {
  options.onExactDuplicate = async (input) => {
    const result = await requestBotMessageReaction({
      botBaseUrl: discordBotUrl,
      channelId: input.channelId,
      messageId: input.messageId,
      emoji: OPPORTUNITY_DUPLICATE_REACTION,
    });
    console.info(
      JSON.stringify({
        level: result.ok ? "info" : "warn",
        event: "exact_duplicate_intake_reaction",
        ok: result.ok,
        error: result.error ?? null,
        raw_event_id: input.rawEventId,
        opportunity_id: input.opportunityId,
        emoji: OPPORTUNITY_DUPLICATE_REACTION,
      }),
    );
  };
}

try {
  const results = await processEventBatch(pool, {
    ...options,
    limit: Number.isFinite(limit) ? limit : 1,
  });

  for (const result of results) {
    console.log(JSON.stringify(result));
  }
} finally {
  await pool.end();
}

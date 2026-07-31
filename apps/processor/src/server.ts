import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { createDatabasePool } from "@recruiting-help/database";
import {
  OPPORTUNITY_DUPLICATE_REACTION,
  requestBotMessageReaction,
} from "@recruiting-help/discord";
import { GeminiStructuredExtractionProvider } from "@recruiting-help/extraction";
import {
  DEFAULT_AUTO_PUBLISH_CONFIDENCE,
  DEFAULT_FEED_DESTINATION_KEY,
  processEventBatch,
  processNextEvent,
  type ProcessNextEventOptions,
  type ProcessNextEventResult,
} from "@recruiting-help/processing";

function sendJson(
  response: ServerResponse,
  statusCode: number,
  body: Record<string, unknown>,
): void {
  const serialized = JSON.stringify(body);
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(serialized),
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  response.end(serialized);
}

async function readJsonBody(
  request: IncomingMessage,
): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let totalBytes = 0;
  for await (const chunk of request) {
    if (!(chunk instanceof Uint8Array)) {
      throw new Error("invalid_body");
    }
    const buffer = Buffer.from(chunk);
    totalBytes += buffer.byteLength;
    if (totalBytes > 16_384) {
      throw new Error("payload_too_large");
    }
    chunks.push(buffer);
  }
  if (chunks.length === 0) {
    return {};
  }
  const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("invalid_json");
  }
  return parsed as Record<string, unknown>;
}

function serializeResult(
  result: ProcessNextEventResult,
): Record<string, unknown> {
  if (result.disposition === "idle") {
    return { disposition: "idle" };
  }
  return {
    disposition: result.disposition,
    raw_event_id: result.rawEventId,
    opportunity_id: result.opportunityId,
    created: result.created,
    outbox_created: result.outboxCreated,
    review_reasons: result.reviewReasons,
  };
}

function loadProcessingOptions(
  environment: NodeJS.ProcessEnv,
): ProcessNextEventOptions {
  const apiKey = environment.GEMINI_API_KEY;
  const confidence = Number(
    environment.AUTO_PUBLISH_CONFIDENCE ?? DEFAULT_AUTO_PUBLISH_CONFIDENCE,
  );
  const discordBotUrl = environment.DISCORD_BOT_URL?.trim();
  const defaultIntakeChannelId =
    environment.DISCORD_INTAKE_CHANNEL_ID?.trim() || undefined;
  const options: ProcessNextEventOptions = {
    provider:
      apiKey === undefined || apiKey.length === 0
        ? null
        : new GeminiStructuredExtractionProvider({ apiKey }),
    destinationKey:
      environment.FEED_DESTINATION_KEY ?? DEFAULT_FEED_DESTINATION_KEY,
    minimumAutoPublishConfidence: Number.isFinite(confidence)
      ? confidence
      : DEFAULT_AUTO_PUBLISH_CONFIDENCE,
    resolveRedirects: environment.RESOLVE_REDIRECTS === "true",
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
          channel_id: input.channelId,
          message_id: input.messageId,
          emoji: OPPORTUNITY_DUPLICATE_REACTION,
        }),
      );
    };
  }
  return options;
}

const connectionString = process.env.DATABASE_URL;
if (connectionString === undefined || connectionString.length === 0) {
  throw new Error("DATABASE_URL is required.");
}

const pool = createDatabasePool(connectionString);
const baseOptions = loadProcessingOptions(process.env);

async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  if (request.method === "GET" && request.url === "/healthz") {
    sendJson(response, 200, { status: "ok" });
    return;
  }
  if (request.method === "GET" && request.url === "/readyz") {
    try {
      await pool.query("SELECT 1");
      sendJson(response, 200, { status: "ready" });
    } catch {
      sendJson(response, 503, { status: "unavailable" });
    }
    return;
  }

  if (
    request.method !== "POST" ||
    (request.url !== "/v1/process-next" && request.url !== "/v1/process-batch")
  ) {
    sendJson(response, 404, { ok: false, error: "not_found" });
    return;
  }

  let body: Record<string, unknown>;
  try {
    body = await readJsonBody(request);
  } catch {
    sendJson(response, 400, { ok: false, error: "invalid_body" });
    return;
  }

  const limitValue = body.limit;
  const limit =
    typeof limitValue === "number" && Number.isInteger(limitValue)
      ? limitValue
      : 1;

  if (request.url === "/v1/process-next") {
    const result = await processNextEvent(pool, baseOptions);
    sendJson(response, 200, {
      ok: true,
      result: serializeResult(result),
    });
    return;
  }

  const results = await processEventBatch(pool, {
    ...baseOptions,
    limit,
  });
  sendJson(response, 200, {
    ok: true,
    count: results.length,
    results: results.map(serializeResult),
  });
}

const server = createServer((request, response) => {
  void handleRequest(request, response).catch((error: unknown) => {
    console.error(
      JSON.stringify({
        level: "error",
        event: "processor_handler_failed",
        code: "internal_error",
        detail: error instanceof Error ? error.message : "unknown",
      }),
    );
    if (!response.headersSent) {
      sendJson(response, 503, { ok: false, error: "processing_unavailable" });
    } else {
      response.destroy();
    }
  });
});

const port = Number(process.env.PORT ?? "3001");
const host = process.env.HOST ?? "0.0.0.0";
await new Promise<void>((resolve, reject) => {
  server.once("error", reject);
  server.listen(port, host, resolve);
});
console.log(
  JSON.stringify({
    level: "info",
    event: "processor_started",
    host,
    port,
    ai_enabled:
      baseOptions.provider !== null && baseOptions.provider !== undefined,
  }),
);

async function shutdown(): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error === undefined ? resolve() : reject(error)));
  });
  await pool.end();
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    void shutdown()
      .then(() => process.exit(0))
      .catch(() => process.exit(1));
  });
}

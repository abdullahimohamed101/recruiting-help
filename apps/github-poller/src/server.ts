import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { resolve } from "node:path";
import { createDatabasePool } from "@recruiting-help/database";
import {
  loadGithubSourcesFromFile,
  pollGithubSource,
} from "@recruiting-help/github";

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

const connectionString = process.env.DATABASE_URL;
if (connectionString === undefined || connectionString.length === 0) {
  throw new Error("DATABASE_URL is required.");
}

const sourcesPath = resolve(
  process.env.SOURCES_CONFIG_PATH ?? "config/sources.example.yaml",
);
const githubToken = process.env.GITHUB_TOKEN?.trim() || null;
const pool = createDatabasePool(connectionString);
const host = process.env.HOST ?? "0.0.0.0";
const port = Number(process.env.PORT ?? "3003");

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

  if (request.method !== "POST" || request.url !== "/v1/poll-github") {
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

  const sourceFilter =
    typeof body.source_id === "string" ? body.source_id : null;
  const sources = await loadGithubSourcesFromFile(sourcesPath);
  const selected =
    sourceFilter === null
      ? sources.filter((source) => source.enabled)
      : sources.filter((source) => source.id === sourceFilter);

  const results = [];
  for (const source of selected) {
    const pollResults = await pollGithubSource({
      pool,
      source,
      token: githubToken,
      jitterMaxMs: Number(process.env.GITHUB_POLL_JITTER_MS ?? "5000"),
    });
    results.push(...pollResults);
  }

  sendJson(response, 200, {
    ok: true,
    count: results.length,
    results,
  });
}

const server = createServer((request, response) => {
  void handleRequest(request, response).catch((error: unknown) => {
    console.error(
      JSON.stringify({
        level: "error",
        event: "github_poller_handler_failed",
        detail: error instanceof Error ? error.message : "unknown",
      }),
    );
    if (!response.headersSent) {
      sendJson(response, 503, { ok: false, error: "poll_unavailable" });
    } else {
      response.destroy();
    }
  });
});

await new Promise<void>((resolve, reject) => {
  server.once("error", reject);
  server.listen(port, host, resolve);
});

console.log(
  JSON.stringify({
    level: "info",
    event: "github_poller_started",
    host,
    port,
    sources_path: sourcesPath,
    token_configured: githubToken !== null,
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

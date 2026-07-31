import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import {
  createDatabasePool,
  persistSignedRawEvent,
} from "@recruiting-help/database";
import {
  createIntakeProcessor,
  DEFAULT_MAX_BODY_BYTES,
  IntakeRequestError,
  publicFailure,
} from "@recruiting-help/ingestion";
import { loadCallerRegistry } from "./callers.js";

async function readBody(request: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let totalBytes = 0;

  for await (const chunk of request) {
    if (!(chunk instanceof Uint8Array)) {
      throw new IntakeRequestError(400, "invalid_body");
    }
    const buffer = Buffer.from(chunk);
    totalBytes += buffer.byteLength;
    if (totalBytes > DEFAULT_MAX_BODY_BYTES) {
      throw new IntakeRequestError(413, "payload_too_large");
    }
    chunks.push(buffer);
  }

  return Buffer.concat(chunks);
}

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

const connectionString = process.env.DATABASE_URL;
if (connectionString === undefined || connectionString.length === 0) {
  throw new Error("DATABASE_URL is required.");
}

const callers = loadCallerRegistry(process.env);
console.log(
  JSON.stringify({
    level: "info",
    event: "intake_callers_loaded",
    caller_ids: Object.keys(callers).sort(),
  }),
);
const pool = createDatabasePool(connectionString);
const processIntake = createIntakeProcessor({
  callers,
  persist: (input) => persistSignedRawEvent(pool, input),
});

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
  if (request.method !== "POST" || request.url !== "/v1/events") {
    sendJson(response, 404, { accepted: false, error: "not_found" });
    return;
  }
  if (!request.headers["content-type"]?.startsWith("application/json")) {
    sendJson(response, 415, {
      accepted: false,
      error: "unsupported_media_type",
    });
    return;
  }

  try {
    const result = await processIntake({
      rawBody: await readBody(request),
      headers: request.headers,
    });
    sendJson(response, 200, result);
  } catch (error) {
    const failure = publicFailure(error);
    console.error(
      JSON.stringify({
        level: "error",
        event: "intake_rejected",
        code: failure.body.error,
        status_code: failure.statusCode,
      }),
    );
    sendJson(response, failure.statusCode, failure.body);
  }
}

const server = createServer((request, response) => {
  void handleRequest(request, response).catch(() => {
    console.error(
      JSON.stringify({
        level: "error",
        event: "intake_handler_failed",
        code: "internal_error",
      }),
    );
    if (!response.headersSent) {
      sendJson(response, 503, {
        accepted: false,
        error: "persistence_unavailable",
      });
    } else {
      response.destroy();
    }
  });
});

const port = Number(process.env.PORT ?? "3000");
const host = process.env.HOST ?? "0.0.0.0";
await new Promise<void>((resolve, reject) => {
  server.once("error", reject);
  server.listen(port, host, resolve);
});
console.log(
  JSON.stringify({
    level: "info",
    event: "intake_api_started",
    host,
    port,
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

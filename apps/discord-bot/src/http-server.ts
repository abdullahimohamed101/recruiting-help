import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import {
  buildOpsAlertMessage,
  type DiscordRestPublisher,
} from "@recruiting-help/discord";
import type { Pool } from "@recruiting-help/database";
import { deliverOutboxBatch } from "./delivery.js";

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

export function createDiscordBotHttpServer(input: {
  pool: Pool;
  publisher: DiscordRestPublisher;
  feedChannelId: string;
  reviewChannelId: string;
  opsChannelId: string;
  discordReady: () => boolean;
}): Server {
  return createServer((request, response) => {
    void (async () => {
      if (request.method === "GET" && request.url === "/healthz") {
        sendJson(response, 200, { status: "ok" });
        return;
      }
      if (request.method === "GET" && request.url === "/readyz") {
        try {
          await input.pool.query("SELECT 1");
          if (!input.discordReady()) {
            sendJson(response, 503, { status: "discord_unavailable" });
            return;
          }
          sendJson(response, 200, { status: "ready" });
        } catch {
          sendJson(response, 503, { status: "unavailable" });
        }
        return;
      }

      if (request.method === "POST" && request.url === "/v1/deliver-batch") {
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
        const results = await deliverOutboxBatch({
          pool: input.pool,
          publisher: input.publisher,
          channels: {
            feedChannelId: input.feedChannelId,
            reviewChannelId: input.reviewChannelId,
          },
          limit,
        });
        sendJson(response, 200, {
          ok: true,
          count: results.length,
          results,
        });
        return;
      }

      if (request.method === "POST" && request.url === "/v1/ops-alert") {
        let body: Record<string, unknown>;
        try {
          body = await readJsonBody(request);
        } catch {
          sendJson(response, 400, { ok: false, error: "invalid_body" });
          return;
        }
        const workflowName =
          typeof body.workflow_name === "string"
            ? body.workflow_name
            : "unknown_workflow";
        const errorCategory =
          typeof body.error_category === "string"
            ? body.error_category
            : "unknown_error";
        const message = buildOpsAlertMessage({
          workflowName,
          errorCategory,
          attemptCount:
            typeof body.attempt_count === "number" ? body.attempt_count : null,
          nextRetryAt:
            typeof body.next_retry_at === "string" ? body.next_retry_at : null,
          executionUrl:
            typeof body.execution_url === "string" ? body.execution_url : null,
          sourceConfigId:
            typeof body.source_config_id === "string"
              ? body.source_config_id
              : null,
        });
        const published = await input.publisher.sendChannelMessage(
          input.opsChannelId,
          message,
        );
        sendJson(response, published.kind === "delivered" ? 200 : 502, {
          ok: published.kind === "delivered",
          result: published,
        });
        return;
      }

      if (request.method === "POST" && request.url === "/v1/react") {
        let body: Record<string, unknown>;
        try {
          body = await readJsonBody(request);
        } catch {
          sendJson(response, 400, { ok: false, error: "invalid_body" });
          return;
        }
        const channelId =
          typeof body.channel_id === "string" ? body.channel_id : "";
        const messageId =
          typeof body.message_id === "string" ? body.message_id : "";
        const emoji = typeof body.emoji === "string" ? body.emoji : "";
        if (
          !/^\d+$/.test(channelId) ||
          !/^\d+$/.test(messageId) ||
          emoji.length === 0 ||
          emoji.length > 64
        ) {
          sendJson(response, 400, { ok: false, error: "invalid_react_target" });
          return;
        }
        if (!input.discordReady()) {
          sendJson(response, 503, { ok: false, error: "discord_unavailable" });
          return;
        }
        const reacted = await input.publisher.addMessageReaction({
          channelId,
          messageId,
          emoji,
        });
        sendJson(response, reacted.kind === "ok" ? 200 : 502, {
          ok: reacted.kind === "ok",
          result: reacted,
        });
        return;
      }

      sendJson(response, 404, { ok: false, error: "not_found" });
    })().catch((error: unknown) => {
      console.error(
        JSON.stringify({
          level: "error",
          event: "discord_bot_http_failed",
          detail: error instanceof Error ? error.message : "unknown",
        }),
      );
      if (!response.headersSent) {
        sendJson(response, 503, { ok: false, error: "internal_error" });
      } else {
        response.destroy();
      }
    });
  });
}

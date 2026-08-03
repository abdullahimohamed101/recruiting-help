import { afterEach, describe, expect, it, vi } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { createDiscordBotHttpServer } from "./http-server.js";

function listen(server: Server): Promise<string> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address() as AddressInfo;
      resolve(`http://127.0.0.1:${address.port}`);
    });
  });
}

describe("discord-bot http server", () => {
  let server: Server | undefined;

  afterEach(async () => {
    if (server === undefined) {
      return;
    }
    const closing = server;
    server = undefined;
    await new Promise<void>((resolve, reject) => {
      closing.close((error) =>
        error === undefined ? resolve() : reject(error),
      );
    });
  });

  it("adds intake reactions via POST /v1/react", async () => {
    const addMessageReaction = vi.fn().mockResolvedValue({ kind: "ok" });
    server = createDiscordBotHttpServer({
      pool: { query: vi.fn() } as never,
      publisher: {
        sendChannelMessage: vi.fn(),
        addMessageReaction,
      },
      feedChannelId: "1",
      reviewChannelId: "2",
      opsChannelId: "3",
      discordReady: () => true,
    });
    const base = await listen(server);

    const response = await fetch(`${base}/v1/react`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        channel_id: "456",
        message_id: "789",
        emoji: "🔁",
      }),
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ ok: true });
    expect(addMessageReaction).toHaveBeenCalledWith({
      channelId: "456",
      messageId: "789",
      emoji: "🔁",
    });
  });

  it("rejects invalid react targets", async () => {
    server = createDiscordBotHttpServer({
      pool: { query: vi.fn() } as never,
      publisher: {
        sendChannelMessage: vi.fn(),
        addMessageReaction: vi.fn(),
      },
      feedChannelId: "1",
      reviewChannelId: "2",
      opsChannelId: "3",
      discordReady: () => true,
    });
    const base = await listen(server);

    const response = await fetch(`${base}/v1/react`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        channel_id: "not-a-snowflake",
        message_id: "789",
        emoji: "🔁",
      }),
    });
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: "invalid_react_target",
    });
  });
});

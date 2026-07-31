import { Client, GatewayIntentBits, Partials, type Message } from "discord.js";
import { createDatabasePool } from "@recruiting-help/database";
import { loadDiscordBotConfig } from "./config.js";
import { createBotDiscordPublisher } from "./discord-http.js";
import { createDiscordBotHttpServer } from "./http-server.js";
import { submitSignedRawEvent } from "./intake-client.js";
import {
  buildRawEventFromDiscordMessage,
  type DiscordMessageLike,
} from "./intake-message.js";

const config = loadDiscordBotConfig();
const pool = createDatabasePool(config.databaseUrl);
const publisher = createBotDiscordPublisher({ token: config.token });

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Channel, Partials.Message],
});

const server = createDiscordBotHttpServer({
  pool,
  publisher,
  feedChannelId: config.feedChannelId,
  reviewChannelId: config.reviewChannelId,
  opsChannelId: config.opsChannelId,
  discordReady: () => client.isReady(),
});

async function react(message: Message, emoji: string): Promise<void> {
  try {
    await message.react(emoji);
  } catch (error) {
    console.error(
      JSON.stringify({
        level: "warn",
        event: "discord_reaction_failed",
        emoji,
        detail: error instanceof Error ? error.message : "unknown",
      }),
    );
  }
}

client.on("messageCreate", (message) => {
  void (async () => {
    if (message.author.bot) {
      return;
    }
    if (message.guildId !== config.guildId) {
      return;
    }
    if (message.channelId !== config.intakeChannelId) {
      return;
    }

    await react(message, "⏳");
    try {
      const event = buildRawEventFromDiscordMessage({
        id: message.id,
        guildId: message.guildId,
        channelId: message.channelId,
        content: message.content,
        createdAt: message.createdAt,
        author: {
          bot: message.author.bot,
          username: message.author.username,
        },
        attachments: [...message.attachments.values()].map((attachment) => ({
          url: attachment.url,
          contentType: attachment.contentType,
          name: attachment.name,
        })),
        messageSnapshots:
          "messageSnapshots" in message
            ? (
                message as Message & {
                  messageSnapshots?: DiscordMessageLike["messageSnapshots"];
                }
              ).messageSnapshots
            : null,
      });
      const result = await submitSignedRawEvent({
        intakeUrl: config.intakeUrl,
        callerId: config.callerId,
        callerSecret: config.callerSecret,
        event,
      });
      if (result.kind === "accepted") {
        await react(message, result.duplicate ? "♻️" : "✅");
        return;
      }
      await react(message, "❌");
      console.error(
        JSON.stringify({
          level: "error",
          event: "discord_intake_rejected",
          error: result.error,
          status_code: result.statusCode,
        }),
      );
    } catch (error) {
      await react(message, "❌");
      console.error(
        JSON.stringify({
          level: "error",
          event: "discord_intake_failed",
          detail: error instanceof Error ? error.message : "unknown",
        }),
      );
    }
  })();
});

await new Promise<void>((resolve, reject) => {
  server.once("error", reject);
  server.listen(config.port, config.host, resolve);
});

await client.login(config.token).catch((error: unknown) => {
  throw error instanceof Error ? error : new Error("discord_login_failed");
});

console.log(
  JSON.stringify({
    level: "info",
    event: "discord_bot_started",
    host: config.host,
    port: config.port,
    guild_id: config.guildId,
  }),
);

async function shutdown(): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error === undefined ? resolve() : reject(error)));
  });
  await Promise.resolve(client.destroy());
  await pool.end();
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    void shutdown()
      .then(() => process.exit(0))
      .catch(() => process.exit(1));
  });
}

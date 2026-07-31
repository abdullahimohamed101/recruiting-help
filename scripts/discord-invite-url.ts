import { buildBotInviteUrl } from "../packages/discord/src/index.js";

const clientId = process.env.DISCORD_CLIENT_ID ?? process.argv[2];
const guildId = process.env.DISCORD_GUILD_ID ?? process.argv[3];

if (clientId === undefined || clientId.length === 0) {
  console.error(
    "Usage: DISCORD_CLIENT_ID=<id> [DISCORD_GUILD_ID=<guild>] corepack pnpm discord:invite-url",
  );
  process.exitCode = 1;
} else {
  console.log(
    buildBotInviteUrl({
      clientId,
      ...(guildId === undefined || guildId.length === 0 ? {} : { guildId }),
    }),
  );
}

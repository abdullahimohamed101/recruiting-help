/** Least-privilege bot permissions for Phase 5 channels. */
export const DISCORD_BOT_PERMISSIONS = {
  viewChannel: 1n << 10n,
  sendMessages: 1n << 11n,
  embedLinks: 1n << 14n,
  attachFiles: 1n << 15n,
  readMessageHistory: 1n << 16n,
  addReactions: 1n << 6n,
} as const;

export function discordBotPermissionBits(): bigint {
  return Object.values(DISCORD_BOT_PERMISSIONS).reduce(
    (total, bit) => total | bit,
    0n,
  );
}

export function buildBotInviteUrl(input: {
  clientId: string;
  guildId?: string;
  permissions?: bigint;
}): string {
  const permissions = (
    input.permissions ?? discordBotPermissionBits()
  ).toString(10);
  const url = new URL("https://discord.com/api/oauth2/authorize");
  url.searchParams.set("client_id", input.clientId);
  url.searchParams.set("permissions", permissions);
  url.searchParams.set("scope", "bot");
  if (input.guildId !== undefined && input.guildId.length > 0) {
    url.searchParams.set("guild_id", input.guildId);
    url.searchParams.set("disable_guild_select", "true");
  }
  return url.toString();
}

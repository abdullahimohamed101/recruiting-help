export type DiscordBotConfig = {
  token: string;
  guildId: string;
  intakeChannelId: string;
  feedChannelId: string;
  reviewChannelId: string;
  opsChannelId: string;
  databaseUrl: string;
  intakeUrl: string;
  callerId: string;
  callerSecret: string;
  host: string;
  port: number;
};

function requireEnv(environment: NodeJS.ProcessEnv, name: string): string {
  const value = environment[name];
  if (value === undefined || value.trim().length === 0) {
    throw new Error(`${name} is required.`);
  }
  return value;
}

export function loadDiscordBotConfig(
  environment: NodeJS.ProcessEnv = process.env,
): DiscordBotConfig {
  return {
    token: requireEnv(environment, "DISCORD_BOT_TOKEN"),
    guildId: requireEnv(environment, "DISCORD_GUILD_ID"),
    intakeChannelId: requireEnv(environment, "DISCORD_INTAKE_CHANNEL_ID"),
    feedChannelId: requireEnv(environment, "DISCORD_FEED_CHANNEL_ID"),
    reviewChannelId: requireEnv(environment, "DISCORD_REVIEW_CHANNEL_ID"),
    opsChannelId: requireEnv(environment, "DISCORD_OPS_CHANNEL_ID"),
    databaseUrl: requireEnv(environment, "DATABASE_URL"),
    intakeUrl: requireEnv(environment, "INTAKE_URL"),
    callerId: requireEnv(environment, "AGGREGATOR_CALLER_ID"),
    callerSecret: requireEnv(environment, "AGGREGATOR_CALLER_SECRET"),
    host: environment.HOST ?? "0.0.0.0",
    port: Number(environment.PORT ?? "3002"),
  };
}

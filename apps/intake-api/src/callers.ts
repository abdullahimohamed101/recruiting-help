import { SourceTypeSchema, type SourceType } from "@recruiting-help/contracts";
import type { CallerConfig, CallerRegistry } from "@recruiting-help/ingestion";

type ExternalCallerConfig = {
  secret?: unknown;
  allowed_sources?: unknown;
};

const DEFAULT_GITHUB_ACCOUNTS = ["vanshb03/Summer2027-Internships"] as const;

function parseCallerConfig(
  callerId: string,
  unvalidatedConfig: unknown,
): {
  secret: string;
  allowedSources: Partial<Record<SourceType, string[]>>;
} {
  const config = unvalidatedConfig as ExternalCallerConfig;
  if (typeof config.secret !== "string" || config.secret.length < 32) {
    throw new Error(
      `Caller ${callerId} must have a secret of at least 32 characters.`,
    );
  }
  if (
    config.allowed_sources === null ||
    typeof config.allowed_sources !== "object" ||
    Array.isArray(config.allowed_sources)
  ) {
    throw new Error(`Caller ${callerId} must define allowed_sources.`);
  }

  const allowedSources: Partial<Record<SourceType, string[]>> = {};
  for (const [unvalidatedSource, unvalidatedAccounts] of Object.entries(
    config.allowed_sources,
  )) {
    const source = SourceTypeSchema.parse(unvalidatedSource);
    if (
      !Array.isArray(unvalidatedAccounts) ||
      unvalidatedAccounts.some(
        (account) => typeof account !== "string" || account.length === 0,
      )
    ) {
      throw new Error(
        `Caller ${callerId} source ${source} must contain account strings.`,
      );
    }
    allowedSources[source] = unvalidatedAccounts as string[];
  }

  return { secret: config.secret, allowedSources };
}

function callersFromObject(parsed: unknown): CallerRegistry {
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("AGGREGATOR_CALLERS_JSON must be a JSON object.");
  }

  const callers: Record<string, CallerConfig> = {};
  for (const [callerId, unvalidatedConfig] of Object.entries(parsed)) {
    callers[callerId] = parseCallerConfig(callerId, unvalidatedConfig);
  }
  return callers;
}

function githubAccountsFromEnv(environment: NodeJS.ProcessEnv): string[] {
  const serialized = environment.AGGREGATOR_ALLOWED_SOURCES_JSON?.trim();
  if (serialized === undefined || serialized.length === 0) {
    return [...DEFAULT_GITHUB_ACCOUNTS];
  }
  try {
    const parsed: unknown = JSON.parse(serialized);
    if (
      parsed === null ||
      typeof parsed !== "object" ||
      Array.isArray(parsed)
    ) {
      return [...DEFAULT_GITHUB_ACCOUNTS];
    }
    const github = (parsed as { github?: unknown }).github;
    if (
      Array.isArray(github) &&
      github.length > 0 &&
      github.every(
        (account) => typeof account === "string" && account.length > 0,
      )
    ) {
      return github as string[];
    }
  } catch {
    // Compose often strips quotes from JSON in .env; keep the default allow-list.
  }
  return [...DEFAULT_GITHUB_ACCOUNTS];
}

/**
 * Local Compose fixture: collector + Discord bot callers from scalar env vars.
 * Avoids AGGREGATOR_CALLERS_JSON in Compose — Docker strips quotes from .env JSON.
 */
export function buildDevelopmentCallerRegistry(
  environment: NodeJS.ProcessEnv,
): CallerRegistry {
  const secret = environment.AGGREGATOR_CALLER_SECRET;
  if (typeof secret !== "string" || secret.length < 32) {
    throw new Error(
      "AGGREGATOR_CALLER_SECRET must be at least 32 characters for the development caller registry.",
    );
  }

  const collectorId =
    environment.AGGREGATOR_CALLER_ID?.trim() || "collector-dev";
  const botCallerId =
    environment.DISCORD_BOT_CALLER_ID?.trim() || "discord-bot-dev";
  const guildId = environment.DISCORD_GUILD_ID?.trim() || "000000000000000000";

  return {
    [collectorId]: {
      secret,
      allowedSources: {
        github: githubAccountsFromEnv(environment),
      },
    },
    [botCallerId]: {
      secret,
      allowedSources: {
        discord_manual: [guildId],
        slack_manual: ["discord-intake"],
        instagram_manual: ["discord-intake"],
      },
    },
  };
}

export function loadCallerRegistry(
  environment: NodeJS.ProcessEnv,
): CallerRegistry {
  const serialized = environment.AGGREGATOR_CALLERS_JSON?.trim();
  if (serialized !== undefined && serialized.length > 0) {
    try {
      return callersFromObject(JSON.parse(serialized) as unknown);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      // Development Compose historically passed mangled JSON from .env (quotes stripped).
      if (
        environment.NODE_ENV === "development" &&
        typeof environment.AGGREGATOR_CALLER_SECRET === "string"
      ) {
        console.error(
          JSON.stringify({
            level: "warn",
            event: "aggregator_callers_json_invalid",
            message:
              "Ignoring invalid AGGREGATOR_CALLERS_JSON; building callers from AGGREGATOR_CALLER_SECRET and DISCORD_GUILD_ID. Remove AGGREGATOR_CALLERS_JSON from .env for Docker Compose.",
            parse_error: detail,
            preview: serialized.slice(0, 96),
          }),
        );
        return buildDevelopmentCallerRegistry(environment);
      }
      throw new Error(
        `AGGREGATOR_CALLERS_JSON is invalid JSON (${detail}). For Docker Compose, omit AGGREGATOR_CALLERS_JSON and set AGGREGATOR_CALLER_SECRET + DISCORD_GUILD_ID instead.`,
      );
    }
  }

  if (typeof environment.AGGREGATOR_CALLER_SECRET === "string") {
    return buildDevelopmentCallerRegistry(environment);
  }

  throw new Error(
    "Provide AGGREGATOR_CALLERS_JSON, or AGGREGATOR_CALLER_SECRET (development Compose builds collector + discord callers from scalar env).",
  );
}

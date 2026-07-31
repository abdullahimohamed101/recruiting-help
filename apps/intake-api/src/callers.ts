import { SourceTypeSchema, type SourceType } from "@recruiting-help/contracts";
import type { CallerConfig, CallerRegistry } from "@recruiting-help/ingestion";

type ExternalCallerConfig = {
  secret?: unknown;
  allowed_sources?: unknown;
};

function parseCallerConfig(
  callerId: string,
  unvalidatedConfig: unknown,
): CallerConfig {
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

function describeInvalidJson(serialized: string, detail: string): string {
  const preview = serialized.slice(0, 120);
  const nonAscii = [...serialized]
    .map((char, index) =>
      char.charCodeAt(0) > 127
        ? `${index}:U+${char.charCodeAt(0).toString(16)}`
        : null,
    )
    .filter((value): value is string => value !== null)
    .slice(0, 8);

  const hints: string[] = [];
  if (
    (serialized.startsWith("'") && serialized.endsWith("'")) ||
    (serialized.startsWith('"') && serialized.endsWith('"'))
  ) {
    hints.push(
      "value appears wrapped in quotes — use unquoted JSON in .env (AGGREGATOR_CALLERS_JSON={...})",
    );
  }
  if (nonAscii.length > 0) {
    hints.push(
      `non-ASCII characters detected (${nonAscii.join(", ")}) — macOS TextEdit smart quotes corrupt JSON; edit with nano/vim or disable smart quotes`,
    );
  }
  if (serialized.includes("map[")) {
    hints.push(
      "value looks like a Go map dump — Compose parsed JSON as YAML; keep the ${AGGREGATOR_CALLERS_JSON:-{...}} form as a single scalar",
    );
  }

  return [
    `AGGREGATOR_CALLERS_JSON is invalid JSON (${detail}).`,
    `preview=${JSON.stringify(preview)}`,
    ...hints,
  ].join(" ");
}

/**
 * Load the caller allow-list.
 *
 * Primary path (Compose + production): AGGREGATOR_CALLERS_JSON.
 * Development fallback: single-caller ID/secret/allowed-sources scalars.
 */
export function loadCallerRegistry(
  environment: NodeJS.ProcessEnv,
): CallerRegistry {
  let serialized = environment.AGGREGATOR_CALLERS_JSON?.trim();

  if (serialized === undefined || serialized.length === 0) {
    const callerId = environment.AGGREGATOR_CALLER_ID;
    const secret = environment.AGGREGATOR_CALLER_SECRET;
    const allowedSources = environment.AGGREGATOR_ALLOWED_SOURCES_JSON;
    if (
      callerId === undefined ||
      secret === undefined ||
      allowedSources === undefined
    ) {
      throw new Error(
        "Provide AGGREGATOR_CALLERS_JSON or the complete single-caller development configuration (AGGREGATOR_CALLER_ID, AGGREGATOR_CALLER_SECRET, AGGREGATOR_ALLOWED_SOURCES_JSON).",
      );
    }
    serialized = JSON.stringify({
      [callerId]: {
        secret,
        allowed_sources: JSON.parse(allowedSources) as unknown,
      },
    });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized) as unknown;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(describeInvalidJson(serialized, detail), { cause: error });
  }

  return callersFromObject(parsed);
}

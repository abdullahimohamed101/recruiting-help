import { describe, expect, it } from "vitest";
import {
  buildDevelopmentCallerRegistry,
  loadCallerRegistry,
} from "./callers.js";

const secret = "development-only-hmac-secret-replace-before-shared-use";

describe("loadCallerRegistry", () => {
  it("builds development callers from scalar env without JSON", () => {
    const callers = loadCallerRegistry({
      NODE_ENV: "development",
      AGGREGATOR_CALLER_SECRET: secret,
      DISCORD_GUILD_ID: "1532181443441201305",
    });

    expect(Object.keys(callers).sort()).toEqual([
      "collector-dev",
      "discord-bot-dev",
    ]);
    expect(callers["discord-bot-dev"]?.allowedSources.discord_manual).toEqual([
      "1532181443441201305",
    ]);
    expect(callers["collector-dev"]?.allowedSources.github).toEqual([
      "vanshb03/Summer2027-Internships",
    ]);
  });

  it("parses valid AGGREGATOR_CALLERS_JSON", () => {
    const callers = loadCallerRegistry({
      AGGREGATOR_CALLERS_JSON: JSON.stringify({
        "collector-dev": {
          secret,
          allowed_sources: { github: ["org/repo"] },
        },
      }),
    });

    expect(callers["collector-dev"]?.allowedSources.github).toEqual([
      "org/repo",
    ]);
  });

  it("ignores mangled AGGREGATOR_CALLERS_JSON in development", () => {
    const callers = loadCallerRegistry({
      NODE_ENV: "development",
      AGGREGATOR_CALLER_SECRET: secret,
      DISCORD_GUILD_ID: "99",
      // Quotes stripped by Compose — invalid JSON
      AGGREGATOR_CALLERS_JSON:
        "{collector-dev:{secret:development-only-hmac-secret-replace-before-shared-use}}",
    });

    expect(callers["discord-bot-dev"]?.allowedSources.discord_manual).toEqual([
      "99",
    ]);
  });

  it("throws on mangled JSON outside development", () => {
    expect(() =>
      loadCallerRegistry({
        NODE_ENV: "production",
        AGGREGATOR_CALLERS_JSON: "{not-json",
        AGGREGATOR_CALLER_SECRET: secret,
      }),
    ).toThrow(/invalid JSON/);
  });
});

describe("buildDevelopmentCallerRegistry", () => {
  it("requires a long enough secret", () => {
    expect(() =>
      buildDevelopmentCallerRegistry({
        AGGREGATOR_CALLER_SECRET: "too-short",
      }),
    ).toThrow(/at least 32/);
  });
});

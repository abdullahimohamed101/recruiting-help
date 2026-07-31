import { describe, expect, it } from "vitest";
import { loadCallerRegistry } from "./callers.js";

const secret = "development-only-hmac-secret-replace-before-shared-use";

describe("loadCallerRegistry", () => {
  it("parses valid AGGREGATOR_CALLERS_JSON", () => {
    const callers = loadCallerRegistry({
      AGGREGATOR_CALLERS_JSON: JSON.stringify({
        "collector-dev": {
          secret,
          allowed_sources: { github: ["org/repo"] },
        },
        "discord-bot-dev": {
          secret,
          allowed_sources: {
            discord_manual: ["1532181443441201305"],
            slack_manual: ["discord-intake"],
            instagram_manual: ["discord-intake"],
          },
        },
      }),
    });

    expect(Object.keys(callers).sort()).toEqual([
      "collector-dev",
      "discord-bot-dev",
    ]);
    expect(callers["discord-bot-dev"]?.allowedSources.discord_manual).toEqual([
      "1532181443441201305",
    ]);
  });

  it("falls back to single-caller scalar configuration", () => {
    const callers = loadCallerRegistry({
      AGGREGATOR_CALLER_ID: "collector-dev",
      AGGREGATOR_CALLER_SECRET: secret,
      AGGREGATOR_ALLOWED_SOURCES_JSON: JSON.stringify({
        github: ["vanshb03/Summer2027-Internships"],
      }),
    });

    expect(callers["collector-dev"]?.allowedSources.github).toEqual([
      "vanshb03/Summer2027-Internships",
    ]);
  });

  it("explains smart-quote corruption clearly", () => {
    expect(() =>
      loadCallerRegistry({
        // Curly quotes like TextEdit can insert
        AGGREGATOR_CALLERS_JSON:
          "{“collector-dev”:{“secret”:“development-only-hmac-secret-replace-before-shared-use”}}",
      }),
    ).toThrow(/smart quotes|non-ASCII|invalid JSON/i);
  });

  it("explains quote-wrapping clearly", () => {
    expect(() =>
      loadCallerRegistry({
        AGGREGATOR_CALLERS_JSON: `'{"collector-dev":{"secret":"${secret}"}}'`,
      }),
    ).toThrow(/wrapped in quotes|invalid JSON/i);
  });
});

import { describe, expect, it, vi } from "vitest";
import {
  buildBotInviteUrl,
  buildFeedMessage,
  buildOpsAlertMessage,
  buildReviewMessage,
  createDiscordRestPublisher,
  discordBotPermissionBits,
  escapeDiscordMarkdown,
} from "./index.js";

describe("discord markdown safety", () => {
  it("escapes markdown and strips control characters", () => {
    expect(escapeDiscordMarkdown("A *bold* @everyone\u0007")).toBe(
      "A \\*bold\\* @everyone",
    );
  });
});

describe("embed builders", () => {
  it("builds a feed message with disabled mentions and category label", () => {
    const message = buildFeedMessage({
      opportunityId: "11111111-1111-4111-8111-111111111111",
      company: "Example Corp",
      role: "Software Engineering Intern",
      locations: ["Remote US"],
      season: "summer",
      year: 2027,
      employmentType: "internship",
      categoryLabel: "Internship",
      sponsorshipStatus: "unknown",
      applicationUrl: "https://jobs.example.com/1",
      deadline: null,
      sourceUrl: "https://github.com/example/repo",
      confidence: 0.99,
    });
    expect(message.allowed_mentions).toEqual({ parse: [] });
    expect(message.embeds[0]?.title).toContain("Example Corp");
    expect(message.embeds[0]?.description).toContain("Internship");
    expect(message.embeds[0]?.url).toBe("https://jobs.example.com/1");
  });

  it("builds review and ops embeds without embedding secrets", () => {
    const review = buildReviewMessage({
      opportunityId: "22222222-2222-4222-8222-222222222222",
      reviewReasons: ["missing_application_url", "low_confidence"],
      excerpt: "Company: Example\nRole: Intern",
      company: "Example",
      role: "Intern",
    });
    expect(review.embeds[0]?.title).toBe("Review required");
    expect(JSON.stringify(review)).not.toMatch(/token|secret|password/i);

    const ops = buildOpsAlertMessage({
      workflowName: "WF-03 Process Raw Events",
      errorCategory: "processor_unavailable",
      attemptCount: 2,
    });
    expect(ops.content).toContain("operations alert");
    expect(JSON.stringify(ops)).not.toMatch(/token|secret|password/i);
  });
});

describe("invite url", () => {
  it("includes least-privilege permission bits", () => {
    const url = buildBotInviteUrl({
      clientId: "1234567890",
      guildId: "9988776655",
    });
    expect(url).toContain("client_id=1234567890");
    expect(url).toContain(
      `permissions=${discordBotPermissionBits().toString(10)}`,
    );
    expect(url).toContain("scope=bot");
    expect(url).toContain("guild_id=9988776655");
  });
});

describe("REST publisher", () => {
  it("maps Discord response classes to delivery outcomes", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce({
        status: 201,
        body: { id: "msg-1" },
      })
      .mockResolvedValueOnce({
        status: 429,
        body: {},
        retryAfterSeconds: 12,
      })
      .mockResolvedValueOnce({
        status: 400,
        body: {},
      });
    const publisher = createDiscordRestPublisher({ request });
    await expect(
      publisher.sendChannelMessage("channel", {
        embeds: [],
        allowed_mentions: { parse: [] },
      }),
    ).resolves.toEqual({ kind: "delivered", messageId: "msg-1" });
    await expect(
      publisher.sendChannelMessage("channel", {
        embeds: [],
        allowed_mentions: { parse: [] },
      }),
    ).resolves.toEqual({
      kind: "rate_limited",
      retryAfterSeconds: 12,
      detail: "rate_limited",
    });
    await expect(
      publisher.sendChannelMessage("channel", {
        embeds: [],
        allowed_mentions: { parse: [] },
      }),
    ).resolves.toEqual({ kind: "permanent", detail: "discord_400" });
  });
});

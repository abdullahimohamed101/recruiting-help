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
  it("builds a lean feed message without empty deadline/sponsorship/confidence", () => {
    const message = buildFeedMessage({
      opportunityId: "11111111-1111-4111-8111-111111111111",
      company: "Rippling",
      role: "Machine Learning Software Engineer Intern - Winter 2027",
      locations: ["San Francisco, CA"],
      season: "winter",
      year: 2027,
      employmentType: "internship",
      categoryLabel: "Internship",
      workMode: null,
      sponsorshipStatus: "unknown",
      applicationUrl: "https://ats.rippling.com/rippling/jobs/abc",
      deadline: null,
      postedAt: "2026-05-13T09:44:09.324Z",
      descriptionExcerpt:
        "About the Role At Rippling, Engineering is at the heart of our business and culture.",
      sourceUrl: "https://discord.com/channels/1/2/3",
      confidence: 0.99,
    });
    expect(message.allowed_mentions).toEqual({ parse: [] });
    expect(message.embeds[0]?.title).toContain("Rippling");
    expect(message.embeds[0]?.description).toContain("Internship");
    expect(message.embeds[0]?.description).toContain("San Francisco, CA");
    expect(message.embeds[0]?.url).toBe(
      "https://ats.rippling.com/rippling/jobs/abc",
    );
    const fieldNames = (message.embeds[0]?.fields ?? []).map(
      (entry) => entry.name,
    );
    expect(fieldNames).toContain("Posted");
    expect(fieldNames).toContain("About");
    expect(fieldNames).not.toContain("Deadline");
    expect(fieldNames).not.toContain("Sponsorship");
    expect(fieldNames).not.toContain("Confidence");
    expect(
      message.embeds[0]?.fields?.find((f) => f.name === "Posted")?.value,
    ).toBe("May 13, 2026");
    expect(
      message.embeds[0]?.fields?.find((f) => f.name === "About")?.value,
    ).toContain("At Rippling, Engineering is at the heart");
  });

  it("includes work mode in the subtitle when present", () => {
    const message = buildFeedMessage({
      opportunityId: "11111111-1111-4111-8111-111111111111",
      company: "Example Corp",
      role: "Software Engineering Intern",
      locations: ["New York, NY"],
      season: "summer",
      year: 2027,
      employmentType: "internship",
      categoryLabel: "Internship",
      workMode: "Hybrid",
      sponsorshipStatus: "does_not_offer",
      applicationUrl: "https://jobs.example.com/1",
      deadline: "2026-08-01",
      sourceUrl: null,
      confidence: 0.9,
    });
    expect(message.embeds[0]?.description).toContain("Hybrid");
    const fieldNames = (message.embeds[0]?.fields ?? []).map(
      (entry) => entry.name,
    );
    expect(fieldNames).toContain("Deadline");
    expect(fieldNames).toContain("Sponsorship");
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

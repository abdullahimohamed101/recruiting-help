import type { RawEvent } from "@recruiting-help/contracts";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_AUTO_PUBLISH_CONFIDENCE,
  DEFAULT_FEED_DESTINATION_KEY,
  discordIntakeReactionTarget,
} from "./index.js";

describe("processing defaults", () => {
  it("keeps conservative auto-publish defaults", () => {
    expect(DEFAULT_AUTO_PUBLISH_CONFIDENCE).toBe(0.85);
    expect(DEFAULT_FEED_DESTINATION_KEY).toBe("internship-feed");
  });
});

describe("discordIntakeReactionTarget", () => {
  it("reads discord_manual metadata", () => {
    const event = {
      schema_version: 1,
      source: "discord_manual",
      source_account: "123",
      source_event_id: "999",
      source_url: "https://discord.com/channels/123/456/999",
      occurred_at: "2026-07-29T22:00:00Z",
      captured_at: "2026-07-29T22:01:00Z",
      author_display: "tester",
      text: "https://example.com/job",
      attachments: [],
      metadata: {
        guild_id: "123",
        channel_id: "456",
        message_id: "999",
        forwarded: false,
      },
    } satisfies RawEvent;
    expect(discordIntakeReactionTarget(event)).toEqual({
      channelId: "456",
      messageId: "999",
    });
  });

  it("uses slack_manual Discord intake channel + source event id", () => {
    const event = {
      schema_version: 1,
      source: "slack_manual",
      source_account: "discord-intake",
      source_event_id: "888",
      source_url: null,
      occurred_at: "2026-07-29T22:00:00Z",
      captured_at: "2026-07-29T22:01:00Z",
      author_display: "tester",
      text: "https://example.com/job",
      attachments: [],
      metadata: {
        workspace: "discord-intake",
        channel_id: "456",
        message_ts: "1710000000.000000",
        thread_ts: null,
      },
    } satisfies RawEvent;
    expect(discordIntakeReactionTarget(event)).toEqual({
      channelId: "456",
      messageId: "888",
    });
  });

  it("uses default intake channel for instagram_manual", () => {
    const event = {
      schema_version: 1,
      source: "instagram_manual",
      source_account: "discord-intake",
      source_event_id: "777",
      source_url: null,
      occurred_at: "2026-07-29T22:00:00Z",
      captured_at: "2026-07-29T22:01:00Z",
      author_display: "tester",
      text: "https://example.com/job",
      attachments: [],
      metadata: {
        username: "discord-intake",
        media_id: "777",
        media_type: "post",
        shortcode: null,
      },
    } satisfies RawEvent;
    expect(discordIntakeReactionTarget(event)).toBeNull();
    expect(
      discordIntakeReactionTarget(event, {
        defaultIntakeChannelId: "456",
      }),
    ).toEqual({ channelId: "456", messageId: "777" });
  });

  it("returns null for github events", () => {
    const event = {
      schema_version: 1,
      source: "github",
      source_account: "org/repo",
      source_event_id: "row-1",
      source_url: "https://github.com/org/repo",
      occurred_at: "2026-07-29T22:00:00Z",
      captured_at: "2026-07-29T22:01:00Z",
      author_display: null,
      text: "row",
      attachments: [],
      metadata: {
        repository: "org/repo",
        branch: "dev",
        path: "README.md",
        commit_sha: "a".repeat(40),
        row_index: 1,
      },
    } satisfies RawEvent;
    expect(discordIntakeReactionTarget(event)).toBeNull();
  });
});

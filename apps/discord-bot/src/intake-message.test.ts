import { describe, expect, it } from "vitest";
import { buildRawEventFromDiscordMessage } from "./intake-message.js";

describe("buildRawEventFromDiscordMessage", () => {
  it("builds a discord_manual event for pasted text", () => {
    const event = buildRawEventFromDiscordMessage({
      id: "111",
      guildId: "222",
      channelId: "333",
      content:
        "Company: Example Corp\nRole: Software Intern\nApply: https://jobs.example.com/1",
      createdAt: new Date("2026-07-30T20:00:00.000Z"),
      author: { bot: false, username: "operator" },
      attachments: [],
    });
    expect(event.source).toBe("discord_manual");
    expect(event.source_event_id).toBe("111");
    expect(event.metadata).toMatchObject({
      guild_id: "222",
      channel_id: "333",
      message_id: "111",
      forwarded: false,
    });
  });

  it("honors source overrides and forward snapshots", () => {
    const slack = buildRawEventFromDiscordMessage({
      id: "444",
      guildId: "222",
      channelId: "333",
      content: "[slack] Intern role https://slack.com/archives/C123/p1",
      createdAt: new Date("2026-07-30T20:00:00.000Z"),
      author: { bot: false, username: "operator" },
      attachments: [],
    });
    expect(slack.source).toBe("slack_manual");

    const forwarded = buildRawEventFromDiscordMessage({
      id: "555",
      guildId: "222",
      channelId: "333",
      content: "",
      createdAt: new Date("2026-07-30T20:00:00.000Z"),
      author: { bot: false, username: "operator" },
      attachments: [],
      messageSnapshots: [
        {
          message: {
            content: "Forwarded internship https://jobs.example.com/2",
            attachments: [],
          },
        },
      ],
    });
    expect(forwarded.source).toBe("discord_manual");
    expect(forwarded.text).toContain("Forwarded internship");
    if (forwarded.source === "discord_manual") {
      expect(forwarded.metadata.forwarded).toBe(true);
    }
  });
});

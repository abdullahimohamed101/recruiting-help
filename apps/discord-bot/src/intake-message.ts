import {
  RawEventSchema,
  type Attachment,
  type RawEvent,
  type SourceType,
} from "@recruiting-help/contracts";

export type DiscordMessageLike = {
  id: string;
  guildId: string | null;
  channelId: string;
  content: string;
  createdAt: Date;
  author: {
    bot: boolean | null;
    username: string;
  };
  attachments: Iterable<{
    url: string;
    contentType: string | null;
    name: string | null;
  }>;
  messageSnapshots?: Iterable<{
    message: {
      content: string | null;
      attachments?: Iterable<{
        url: string;
        contentType?: string | null;
        name?: string | null;
      }>;
    };
  }> | null;
};

function detectSourceOverride(content: string): SourceType | null {
  const match = content.trim().match(/^\[(slack|instagram|discord)\]\s*/iu);
  if (match === null) {
    return null;
  }
  const value = match[1]?.toLowerCase();
  if (value === "slack") {
    return "slack_manual";
  }
  if (value === "instagram") {
    return "instagram_manual";
  }
  return "discord_manual";
}

function stripSourceOverride(content: string): string {
  return content.replace(/^\[(slack|instagram|discord)\]\s*/iu, "").trim();
}

function inferSourceFromUrls(content: string): SourceType {
  if (/https?:\/\/(?:www\.)?slack\.com\//iu.test(content)) {
    return "slack_manual";
  }
  if (/https?:\/\/(?:www\.)?instagram\.com\//iu.test(content)) {
    return "instagram_manual";
  }
  return "discord_manual";
}

function toAttachments(
  attachments: Iterable<{
    url: string;
    contentType?: string | null;
    name?: string | null;
  }>,
): Attachment[] {
  const result: Attachment[] = [];
  for (const attachment of attachments) {
    const contentType = attachment.contentType ?? null;
    result.push({
      type: contentType?.startsWith("image/") ? "image" : "file",
      url: attachment.url,
      content_type: contentType,
      filename: attachment.name ?? null,
    });
  }
  return result;
}

export function buildRawEventFromDiscordMessage(
  message: DiscordMessageLike,
): RawEvent {
  if (message.guildId === null) {
    throw new Error("Intake messages must belong to a guild.");
  }

  const snapshots = [...(message.messageSnapshots ?? [])];
  const snapshot = snapshots[0]?.message;
  const hasForwardSnapshot = snapshot !== undefined;
  const rawContent = hasForwardSnapshot
    ? (snapshot.content ?? "")
    : message.content;
  const override = detectSourceOverride(message.content);
  const content = stripSourceOverride(rawContent);
  const source =
    override ??
    (hasForwardSnapshot ? "discord_manual" : inferSourceFromUrls(content));
  const attachments = toAttachments(
    hasForwardSnapshot ? (snapshot.attachments ?? []) : message.attachments,
  );

  if (source === "discord_manual") {
    return RawEventSchema.parse({
      schema_version: 1,
      source: "discord_manual",
      source_account: message.guildId,
      source_event_id: message.id,
      source_url: `https://discord.com/channels/${message.guildId}/${message.channelId}/${message.id}`,
      occurred_at: message.createdAt.toISOString(),
      captured_at: new Date().toISOString(),
      author_display: message.author.username,
      text: content.length > 0 ? content : null,
      attachments,
      metadata: {
        guild_id: message.guildId,
        channel_id: message.channelId,
        message_id: message.id,
        forwarded: hasForwardSnapshot,
      },
    });
  }

  if (source === "slack_manual") {
    return RawEventSchema.parse({
      schema_version: 1,
      source: "slack_manual",
      source_account: "discord-intake",
      source_event_id: message.id,
      source_url: null,
      occurred_at: message.createdAt.toISOString(),
      captured_at: new Date().toISOString(),
      author_display: message.author.username,
      text: content.length > 0 ? content : null,
      attachments,
      metadata: {
        workspace: "discord-intake",
        channel_id: message.channelId,
        message_ts: `${Math.floor(message.createdAt.getTime() / 1_000)}.000000`,
        thread_ts: null,
      },
    });
  }

  return RawEventSchema.parse({
    schema_version: 1,
    source: "instagram_manual",
    source_account: "discord-intake",
    source_event_id: message.id,
    source_url: null,
    occurred_at: message.createdAt.toISOString(),
    captured_at: new Date().toISOString(),
    author_display: message.author.username,
    text: content.length > 0 ? content : null,
    attachments,
    metadata: {
      username: "discord-intake",
      media_id: message.id,
      media_type: "post",
      shortcode: null,
    },
  });
}

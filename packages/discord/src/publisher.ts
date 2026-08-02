import type { DiscordMessagePayload } from "./embeds.js";

export type DiscordPublishResult =
  | {
      kind: "delivered";
      messageId: string;
    }
  | {
      kind: "rate_limited";
      retryAfterSeconds: number;
      detail: string;
    }
  | {
      kind: "retryable";
      detail: string;
    }
  | {
      kind: "permanent";
      detail: string;
    };

export type DiscordReactionResult =
  | { kind: "ok" }
  | {
      kind: "rate_limited";
      retryAfterSeconds: number;
      detail: string;
    }
  | {
      kind: "retryable";
      detail: string;
    }
  | {
      kind: "permanent";
      detail: string;
    };

export interface DiscordRestPublisher {
  sendChannelMessage(
    channelId: string,
    payload: DiscordMessagePayload,
  ): Promise<DiscordPublishResult>;
  addMessageReaction(input: {
    channelId: string;
    messageId: string;
    emoji: string;
  }): Promise<DiscordReactionResult>;
}

export type DiscordHttpResponse = {
  status: number;
  body: unknown;
  retryAfterSeconds?: number;
};

export type DiscordHttpRequest = (input: {
  method: "POST" | "PUT";
  path: string;
  body?: DiscordMessagePayload;
}) => Promise<DiscordHttpResponse>;

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function mapStatusToReactionResult(
  response: DiscordHttpResponse,
): DiscordReactionResult {
  if (response.status === 204 || response.status === 200) {
    return { kind: "ok" };
  }
  if (response.status === 429) {
    return {
      kind: "rate_limited",
      retryAfterSeconds: response.retryAfterSeconds ?? 30,
      detail: "rate_limited",
    };
  }
  if (response.status >= 500) {
    return {
      kind: "retryable",
      detail: `discord_${response.status}`,
    };
  }
  if (response.status >= 400) {
    return {
      kind: "permanent",
      detail: `discord_${response.status}`,
    };
  }
  return {
    kind: "retryable",
    detail: `discord_${response.status}`,
  };
}

export function createDiscordRestPublisher(input: {
  request: DiscordHttpRequest;
}): DiscordRestPublisher {
  return {
    async sendChannelMessage(channelId, payload) {
      try {
        const response = await input.request({
          method: "POST",
          path: `/channels/${channelId}/messages`,
          body: payload,
        });
        if (response.status === 200 || response.status === 201) {
          const body = asRecord(response.body);
          const messageId = body?.id;
          if (typeof messageId !== "string" || messageId.length === 0) {
            return {
              kind: "retryable",
              detail: "Discord response missing message id",
            };
          }
          return { kind: "delivered", messageId };
        }
        if (response.status === 429) {
          return {
            kind: "rate_limited",
            retryAfterSeconds: response.retryAfterSeconds ?? 30,
            detail: "rate_limited",
          };
        }
        if (response.status >= 500) {
          return {
            kind: "retryable",
            detail: `discord_${response.status}`,
          };
        }
        if (response.status >= 400) {
          return {
            kind: "permanent",
            detail: `discord_${response.status}`,
          };
        }
        return {
          kind: "retryable",
          detail: `discord_${response.status}`,
        };
      } catch (error) {
        return {
          kind: "retryable",
          detail:
            error instanceof Error
              ? error.message.slice(0, 200)
              : "network_error",
        };
      }
    },
    async addMessageReaction({ channelId, messageId, emoji }) {
      try {
        const encoded = encodeURIComponent(emoji);
        const response = await input.request({
          method: "PUT",
          path: `/channels/${channelId}/messages/${messageId}/reactions/${encoded}/@me`,
        });
        return mapStatusToReactionResult(response);
      } catch (error) {
        return {
          kind: "retryable",
          detail:
            error instanceof Error
              ? error.message.slice(0, 200)
              : "network_error",
        };
      }
    },
  };
}

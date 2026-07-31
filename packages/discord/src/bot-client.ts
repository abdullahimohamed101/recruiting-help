/** Reaction when processing finds an already-submitted opportunity. */
export const OPPORTUNITY_DUPLICATE_REACTION = "🔁";

export async function requestBotMessageReaction(input: {
  botBaseUrl: string;
  channelId: string;
  messageId: string;
  emoji: string;
  fetchImpl?: typeof fetch;
}): Promise<{ ok: boolean; error?: string }> {
  const base = input.botBaseUrl.replace(/\/+$/, "");
  const fetchImpl = input.fetchImpl ?? fetch;
  try {
    const response = await fetchImpl(`${base}/v1/react`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        channel_id: input.channelId,
        message_id: input.messageId,
        emoji: input.emoji,
      }),
    });
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as {
        error?: string;
      } | null;
      return {
        ok: false,
        error: body?.error ?? `http_${response.status}`,
      };
    }
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message.slice(0, 200) : "network_error",
    };
  }
}

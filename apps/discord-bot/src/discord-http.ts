import {
  createDiscordRestPublisher,
  type DiscordHttpRequest,
  type DiscordRestPublisher,
} from "@recruiting-help/discord";

export function createBotTokenHttpRequest(input: {
  token: string;
  fetchImpl?: typeof fetch;
}): DiscordHttpRequest {
  const fetchImpl = input.fetchImpl ?? fetch;
  return async ({ method, path, body }) => {
    const headers: Record<string, string> = {
      authorization: `Bot ${input.token}`,
    };
    const init: RequestInit = { method, headers };
    if (body !== undefined) {
      headers["content-type"] = "application/json";
      init.body = JSON.stringify(body);
    }
    const response = await fetchImpl(
      `https://discord.com/api/v10${path}`,
      init,
    );
    const text = await response.text();
    let responseBody: unknown = null;
    if (text.length > 0) {
      try {
        responseBody = JSON.parse(text) as unknown;
      } catch {
        responseBody = null;
      }
    }
    const result: {
      status: number;
      body: unknown;
      retryAfterSeconds?: number;
    } = {
      status: response.status,
      body: responseBody,
    };
    if (response.status === 429) {
      const header = response.headers.get("retry-after");
      if (header !== null) {
        const parsed = Number(header);
        if (Number.isFinite(parsed)) {
          result.retryAfterSeconds = parsed;
        }
      }
      if (
        result.retryAfterSeconds === undefined &&
        responseBody !== null &&
        typeof responseBody === "object" &&
        !Array.isArray(responseBody) &&
        "retry_after" in responseBody &&
        typeof responseBody.retry_after === "number"
      ) {
        result.retryAfterSeconds = responseBody.retry_after;
      }
    }
    return result;
  };
}

export function createBotDiscordPublisher(input: {
  token: string;
  fetchImpl?: typeof fetch;
}): DiscordRestPublisher {
  return createDiscordRestPublisher({
    request: createBotTokenHttpRequest(input),
  });
}

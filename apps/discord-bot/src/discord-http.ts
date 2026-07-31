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
    const response = await fetchImpl(`https://discord.com/api/v10${path}`, {
      method,
      headers: {
        authorization: `Bot ${input.token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });
    const responseBody: unknown = await response.json().catch(() => null);
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

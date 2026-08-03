export type GithubFileFetchResult =
  | { kind: "not_modified" }
  | {
      kind: "ok";
      content: string;
      etag: string | null;
      sha: string;
      rateLimitRemaining: number | null;
    }
  | {
      kind: "rate_limited";
      retryAfterSeconds: number;
      detail: string;
    }
  | {
      kind: "not_found";
      detail: string;
    }
  | {
      kind: "error";
      status: number;
      detail: string;
    };

function parseRetryAfter(header: string | null): number {
  if (header === null) {
    return 60;
  }
  const asNumber = Number(header);
  if (Number.isFinite(asNumber) && asNumber >= 0) {
    return Math.max(1, Math.floor(asNumber));
  }
  const asDate = Date.parse(header);
  if (Number.isFinite(asDate)) {
    return Math.max(1, Math.ceil((asDate - Date.now()) / 1_000));
  }
  return 60;
}

export async function fetchGithubFileContent(input: {
  owner: string;
  repo: string;
  path: string;
  ref: string;
  etag?: string | null;
  token?: string | null;
  fetchImpl?: typeof fetch;
  userAgent?: string;
}): Promise<GithubFileFetchResult> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const headers: Record<string, string> = {
    accept: "application/vnd.github+json",
    "x-github-api-version": "2022-11-28",
    "user-agent": input.userAgent ?? "recruiting-help-github-poller",
  };
  if (
    input.token !== undefined &&
    input.token !== null &&
    input.token.length > 0
  ) {
    headers.authorization = `Bearer ${input.token}`;
  }
  if (
    input.etag !== undefined &&
    input.etag !== null &&
    input.etag.length > 0
  ) {
    headers["if-none-match"] = input.etag;
  }

  const url = new URL(
    `https://api.github.com/repos/${input.owner}/${input.repo}/contents/${input.path}`,
  );
  url.searchParams.set("ref", input.ref);

  let response: Response;
  try {
    response = await fetchImpl(url, { method: "GET", headers });
  } catch (error) {
    return {
      kind: "error",
      status: 0,
      detail:
        error instanceof Error ? error.message.slice(0, 200) : "network_error",
    };
  }

  const remainingHeader = response.headers.get("x-ratelimit-remaining");
  const remaining =
    remainingHeader === null ? null : Number.parseInt(remainingHeader, 10);

  if (response.status === 304) {
    return { kind: "not_modified" };
  }
  if (response.status === 404) {
    return { kind: "not_found", detail: "github_file_not_found" };
  }
  if (response.status === 429 || response.status === 403) {
    const bodyText = await response.text().catch(() => "");
    if (
      response.status === 429 ||
      /rate limit/iu.test(bodyText) ||
      remaining === 0
    ) {
      return {
        kind: "rate_limited",
        retryAfterSeconds: parseRetryAfter(response.headers.get("retry-after")),
        detail: "github_rate_limited",
      };
    }
  }
  if (!response.ok) {
    return {
      kind: "error",
      status: response.status,
      detail: `github_${response.status}`,
    };
  }

  const body: unknown = await response.json().catch(() => null);
  if (
    body === null ||
    typeof body !== "object" ||
    Array.isArray(body) ||
    typeof (body as { content?: unknown }).content !== "string" ||
    typeof (body as { sha?: unknown }).sha !== "string"
  ) {
    return {
      kind: "error",
      status: response.status,
      detail: "invalid_github_body",
    };
  }
  const encoding = (body as { encoding?: unknown }).encoding;
  const contentField = (body as { content: string }).content;
  const sha = (body as { sha: string }).sha;
  const decoded =
    encoding === "base64"
      ? Buffer.from(contentField.replace(/\n/gu, ""), "base64").toString("utf8")
      : contentField;

  return {
    kind: "ok",
    content: decoded,
    etag: response.headers.get("etag"),
    sha,
    rateLimitRemaining: Number.isFinite(remaining) ? remaining : null,
  };
}

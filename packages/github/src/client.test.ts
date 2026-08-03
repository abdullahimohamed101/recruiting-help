import { describe, expect, it, vi } from "vitest";
import { fetchGithubFileContent } from "./client.js";

describe("fetchGithubFileContent", () => {
  it("returns not_modified on 304", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      status: 304,
      ok: false,
      headers: new Headers(),
    });
    await expect(
      fetchGithubFileContent({
        owner: "vanshb03",
        repo: "Summer2027-Internships",
        path: "README.md",
        ref: "dev",
        etag: '"abc"',
        fetchImpl,
      }),
    ).resolves.toEqual({ kind: "not_modified" });
  });

  it("decodes base64 content on 200", async () => {
    const content = Buffer.from("# hi\n").toString("base64");
    const fetchImpl = vi.fn().mockResolvedValue({
      status: 200,
      ok: true,
      headers: new Headers({
        etag: '"etag-1"',
        "x-ratelimit-remaining": "4999",
      }),
      json: () =>
        Promise.resolve({
          content,
          encoding: "base64",
          sha: "a".repeat(40),
        }),
    });
    await expect(
      fetchGithubFileContent({
        owner: "vanshb03",
        repo: "Summer2027-Internships",
        path: "README.md",
        ref: "dev",
        fetchImpl,
      }),
    ).resolves.toEqual({
      kind: "ok",
      content: "# hi\n",
      etag: '"etag-1"',
      sha: "a".repeat(40),
      rateLimitRemaining: 4999,
    });
  });

  it("maps 429 to rate_limited", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      status: 429,
      ok: false,
      headers: new Headers({ "retry-after": "12" }),
      text: () => Promise.resolve("rate limit"),
    });
    await expect(
      fetchGithubFileContent({
        owner: "vanshb03",
        repo: "Summer2027-Internships",
        path: "README.md",
        ref: "dev",
        fetchImpl,
      }),
    ).resolves.toEqual({
      kind: "rate_limited",
      retryAfterSeconds: 12,
      detail: "github_rate_limited",
    });
  });

  it("maps network failure to error", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("timeout"));
    await expect(
      fetchGithubFileContent({
        owner: "vanshb03",
        repo: "Summer2027-Internships",
        path: "README.md",
        ref: "dev",
        fetchImpl,
      }),
    ).resolves.toEqual({
      kind: "error",
      status: 0,
      detail: "timeout",
    });
  });
});

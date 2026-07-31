import { describe, expect, it, vi } from "vitest";
import {
  createIntakeProcessor,
  IntakeRequestError,
  publicFailure,
  signRawBody,
  verifySignedRequest,
  type CallerRegistry,
  type PersistenceResult,
  type SignedRequest,
} from "./index.js";

const now = new Date("2026-07-30T07:15:00.000Z");
const callerId = "collector-dev";
const secret = "development-test-secret-at-least-32-characters";
const sourceAccount = "vanshb03/Summer2027-Internships";
const callers: CallerRegistry = {
  [callerId]: {
    secret,
    allowedSources: {
      github: [sourceAccount],
    },
  },
};

function eventBody(overrides: Record<string, unknown> = {}): Buffer {
  return Buffer.from(
    JSON.stringify({
      schema_version: 1,
      source: "github",
      source_account: sourceAccount,
      source_event_id: "dev:README.md:abc123:42",
      source_url:
        "https://github.com/vanshb03/Summer2027-Internships/blob/dev/README.md",
      occurred_at: "2026-07-30T07:14:00Z",
      captured_at: "2026-07-30T07:15:00Z",
      author_display: null,
      text: "Example internship",
      attachments: [],
      metadata: {
        repository: sourceAccount,
        branch: "dev",
        path: "README.md",
        commit_sha: "a".repeat(40),
        row_index: 42,
      },
      ...overrides,
    }),
    "utf8",
  );
}

function signedRequest(
  rawBody: Buffer,
  overrides: {
    timestamp?: string;
    nonce?: string;
    signingSecret?: string;
  } = {},
): SignedRequest {
  return {
    rawBody,
    headers: signRawBody({
      callerId,
      secret: overrides.signingSecret ?? secret,
      rawBody,
      timestamp:
        overrides.timestamp ?? Math.floor(now.getTime() / 1_000).toString(),
      nonce: overrides.nonce ?? "nonce_12345678901234567890",
    }),
  };
}

describe("signed request protocol", () => {
  it("verifies the exact signed bytes", () => {
    const original = Buffer.from('{"a":1}', "utf8");
    const request = signedRequest(original);
    request.rawBody = Buffer.from('{ "a": 1 }', "utf8");

    expect(() => verifySignedRequest({ request, callers, now })).toThrowError(
      IntakeRequestError,
    );
  });

  it("binds the nonce to the signature", () => {
    const request = signedRequest(eventBody());
    request.headers["x-aggregator-nonce"] = "different_nonce_123456789";

    expect(() => verifySignedRequest({ request, callers, now })).toThrowError(
      IntakeRequestError,
    );
  });

  it("rejects stale timestamps", () => {
    const request = signedRequest(eventBody(), {
      timestamp: Math.floor((now.getTime() - 301_000) / 1_000).toString(),
    });

    expect(() => verifySignedRequest({ request, callers, now })).toThrowError(
      expect.objectContaining({ publicCode: "stale_timestamp" }),
    );
  });

  it("rejects unknown callers without revealing caller state", () => {
    const request = signedRequest(eventBody());
    request.headers["x-aggregator-caller"] = "unknown-caller";

    expect(() => verifySignedRequest({ request, callers, now })).toThrowError(
      expect.objectContaining({ publicCode: "unauthorized" }),
    );
  });
});

describe("intake processor", () => {
  it("accepts a valid event", async () => {
    const persist = vi.fn((): Promise<PersistenceResult> =>
      Promise.resolve({
        kind: "accepted",
        rawEventId: "1b22bfa7-3945-4a06-8c3e-fc8caa5b7d8f",
        inserted: true,
      }),
    );
    const processRequest = createIntakeProcessor({
      callers,
      persist,
      now: () => now,
    });

    await expect(processRequest(signedRequest(eventBody()))).resolves.toEqual({
      accepted: true,
      duplicate: false,
      raw_event_id: "1b22bfa7-3945-4a06-8c3e-fc8caa5b7d8f",
    });
    expect(persist).toHaveBeenCalledOnce();
  });

  it("reports a duplicate event submitted with a fresh nonce", async () => {
    const processRequest = createIntakeProcessor({
      callers,
      persist: () =>
        Promise.resolve({
          kind: "accepted",
          rawEventId: "1b22bfa7-3945-4a06-8c3e-fc8caa5b7d8f",
          inserted: false,
        }),
      now: () => now,
    });

    await expect(
      processRequest(
        signedRequest(eventBody(), {
          nonce: "fresh_nonce_123456789012345",
        }),
      ),
    ).resolves.toMatchObject({ accepted: true, duplicate: true });
  });

  it("rejects a replayed nonce", async () => {
    const processRequest = createIntakeProcessor({
      callers,
      persist: () => Promise.resolve({ kind: "replayed_nonce" }),
      now: () => now,
    });

    await expect(
      processRequest(signedRequest(eventBody())),
    ).rejects.toMatchObject({ publicCode: "replayed_nonce", statusCode: 409 });
  });

  it("rejects a source account outside the caller allow-list", async () => {
    const rawBody = eventBody({ source_account: "unapproved/repository" });
    const processRequest = createIntakeProcessor({
      callers,
      persist: vi.fn(),
      now: () => now,
    });

    await expect(processRequest(signedRequest(rawBody))).rejects.toMatchObject({
      publicCode: "source_not_allowed",
    });
  });

  it("rejects oversized bodies before persistence", async () => {
    const rawBody = eventBody({ text: "x".repeat(5_000) });
    const processRequest = createIntakeProcessor({
      callers,
      persist: vi.fn(),
      now: () => now,
      maxBodyBytes: 1_000,
    });

    await expect(processRequest(signedRequest(rawBody))).rejects.toMatchObject({
      publicCode: "payload_too_large",
    });
  });

  it("rejects oversized attachment metadata", async () => {
    const rawBody = eventBody({
      attachments: [
        {
          type: "image",
          url: "https://example.com/internship.png",
          content_type: "image/png",
        },
      ],
    });
    const processRequest = createIntakeProcessor({
      callers,
      persist: vi.fn(),
      now: () => now,
      maxAttachmentMetadataBytes: 10,
    });

    await expect(processRequest(signedRequest(rawBody))).rejects.toMatchObject({
      publicCode: "attachment_metadata_too_large",
    });
  });

  it("does not turn persistence failures into success", async () => {
    const processRequest = createIntakeProcessor({
      callers,
      persist: () => Promise.reject(new Error("database unavailable")),
      now: () => now,
    });

    const error = await processRequest(signedRequest(eventBody())).catch(
      (caught: unknown) => caught,
    );
    expect(publicFailure(error)).toEqual({
      statusCode: 503,
      body: { accepted: false, error: "persistence_unavailable" },
    });
  });
});

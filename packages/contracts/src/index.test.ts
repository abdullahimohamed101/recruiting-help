import { describe, expect, it } from "vitest";
import {
  DeliveryStatusSchema,
  OpportunityCandidateSchema,
  RawEventSchema,
  type RawEvent,
} from "./index.js";

const githubEvent: RawEvent = {
  schema_version: 1,
  source: "github",
  source_account: "vanshb03/Summer2027-Internships",
  source_event_id: "dev:README.md:abc123:42",
  source_url:
    "https://github.com/vanshb03/Summer2027-Internships/blob/dev/README.md",
  occurred_at: "2026-07-29T22:00:00Z",
  captured_at: "2026-07-29T22:01:00Z",
  author_display: null,
  text: "| Example | Software Engineer Intern | Remote US | ... | Jul 29 |",
  attachments: [],
  metadata: {
    repository: "vanshb03/Summer2027-Internships",
    branch: "dev",
    path: "README.md",
    commit_sha: "a".repeat(40),
    row_index: 42,
  },
};

describe("RawEventSchema", () => {
  it("accepts a versioned GitHub event", () => {
    expect(RawEventSchema.parse(githubEvent)).toEqual(githubEvent);
  });

  it("rejects source metadata from the wrong connector", () => {
    const result = RawEventSchema.safeParse({
      ...githubEvent,
      metadata: {
        guild_id: "1",
        channel_id: "2",
        message_id: "3",
        forwarded: false,
      },
    });

    expect(result.success).toBe(false);
  });

  it("rejects credential-shaped extra metadata", () => {
    const result = RawEventSchema.safeParse({
      ...githubEvent,
      metadata: {
        ...githubEvent.metadata,
        token: "must-not-enter-the-contract",
      },
    });

    expect(result.success).toBe(false);
  });
});

describe("OpportunityCandidateSchema", () => {
  it("preserves unknown values as null", () => {
    const candidate = OpportunityCandidateSchema.parse({
      schema_version: 1,
      company: "Example",
      role: null,
      locations: ["Remote US"],
      season: null,
      year: 2027,
      employment_type: "internship",
      sponsorship_status: "unknown",
      application_url: null,
      deadline: null,
      posted_at: null,
      source_url: "https://example.com/source",
      description_excerpt: null,
      confidence: 0.5,
      evidence: {
        company: "Example",
      },
    });

    expect(candidate.role).toBeNull();
    expect(candidate.application_url).toBeNull();
  });
});

describe("status schemas", () => {
  it("rejects invalid delivery states", () => {
    expect(DeliveryStatusSchema.safeParse("lost").success).toBe(false);
  });
});

import { createHash } from "node:crypto";
import type { RawEvent } from "@recruiting-help/contracts";
import {
  claimNextRawEvent,
  createDatabasePool,
  createOpportunity,
  insertRawEvent,
  migrateToLatest,
  persistProcessedOpportunity,
  type Pool,
} from "@recruiting-help/database";
import {
  assertTestDatabaseUrl,
  createRawEventFixture,
  resetTestDatabase,
} from "@recruiting-help/database/testing";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { processNextEvent, processWorkItem } from "./index.js";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const describeWithDatabase =
  testDatabaseUrl === undefined ? describe.skip : describe;

type CountRow = { count: number };

function payloadHash(event: RawEvent): string {
  return createHash("sha256").update(JSON.stringify(event)).digest("hex");
}

function opportunityRow(input: {
  sourceEventId: string;
  company: string;
  role: string;
  applicationUrl: string;
  closed?: boolean;
}): RawEvent {
  const closedMarker = input.closed === true ? " 🔒" : "";
  return createRawEventFixture({
    source_event_id: input.sourceEventId,
    text: `| ${input.company} | ${input.role}${closedMarker} 🛂 | Remote US | [Apply](${input.applicationUrl}) | Jul 29 |`,
  });
}

describeWithDatabase("processing integration", () => {
  let pool: Pool;

  beforeAll(async () => {
    if (testDatabaseUrl === undefined) {
      return;
    }
    assertTestDatabaseUrl(testDatabaseUrl);
    pool = createDatabasePool(testDatabaseUrl);
    await migrateToLatest(pool);
  });

  afterEach(async () => {
    if (testDatabaseUrl !== undefined) {
      await resetTestDatabase(pool, testDatabaseUrl);
    }
  });

  afterAll(async () => {
    await pool.end();
  });

  it("claims exactly one raw event under concurrent workers", async () => {
    const event = opportunityRow({
      sourceEventId: "claim-concurrent",
      company: "Example Corp",
      role: "Software Engineering Intern",
      applicationUrl: "https://jobs.lever.co/example/claim-1",
    });
    await insertRawEvent(pool, {
      event,
      payloadSha256: payloadHash(event),
      sourceConfigId: null,
    });

    const claims = await Promise.all(
      Array.from({ length: 8 }, () => claimNextRawEvent(pool)),
    );
    expect(claims.filter((claim) => claim !== null)).toHaveLength(1);
  });

  it("processes a deterministic opportunity into one outbox row", async () => {
    const event = opportunityRow({
      sourceEventId: "process-happy",
      company: "Example Corp",
      role: "Software Engineering Intern",
      applicationUrl: "https://jobs.lever.co/example/happy-1?utm_source=gh",
    });
    await insertRawEvent(pool, {
      event,
      payloadSha256: payloadHash(event),
      sourceConfigId: null,
    });

    const result = await processNextEvent(pool, { provider: null });
    expect(result).toMatchObject({
      disposition: "processed",
      created: true,
      outboxCreated: true,
    });

    const opportunities = await pool.query<CountRow>(
      "SELECT count(*)::int AS count FROM aggregator.opportunities",
    );
    const outbox = await pool.query<CountRow>(
      "SELECT count(*)::int AS count FROM aggregator.delivery_outbox",
    );
    const raw = await pool.query<{ status: string }>(
      "SELECT status FROM aggregator.raw_events",
    );
    expect(opportunities.rows[0]?.count).toBe(1);
    expect(outbox.rows[0]?.count).toBe(1);
    expect(raw.rows[0]?.status).toBe("processed");
  });

  it("dedupes the same application URL across source events", async () => {
    const url = "https://boards.greenhouse.io/example/jobs/99";
    const first = opportunityRow({
      sourceEventId: "url-a",
      company: "Example Corp",
      role: "Software Engineering Intern",
      applicationUrl: `${url}?utm_campaign=one`,
    });
    const second = opportunityRow({
      sourceEventId: "url-b",
      company: "Example Corp",
      role: "Software Engineering Intern",
      applicationUrl: `${url}?utm_campaign=two`,
    });
    await insertRawEvent(pool, {
      event: first,
      payloadSha256: payloadHash(first),
      sourceConfigId: null,
    });
    await insertRawEvent(pool, {
      event: second,
      payloadSha256: payloadHash(second),
      sourceConfigId: null,
    });

    const firstResult = await processNextEvent(pool, { provider: null });
    const secondResult = await processNextEvent(pool, { provider: null });
    expect(firstResult).toMatchObject({
      disposition: "processed",
      created: true,
      outboxCreated: true,
    });
    expect(secondResult).toMatchObject({
      disposition: "processed",
      created: false,
      outboxCreated: false,
    });
    if (
      firstResult.disposition === "processed" &&
      secondResult.disposition === "processed"
    ) {
      expect(secondResult.opportunityId).toBe(firstResult.opportunityId);
    }

    const onExactDuplicate = vi.fn();
    const discordDuplicate = createRawEventFixture({
      source: "discord_manual",
      source_account: "123",
      source_event_id: "url-c",
      source_url: "https://discord.com/channels/123/456/url-c",
      text: `| Example Corp | Software Engineering Intern 🛂 | Remote US | [Apply](${url}?utm_campaign=three) | Jul 29 |`,
      metadata: {
        guild_id: "123",
        channel_id: "456",
        message_id: "101112",
        forwarded: false,
      },
    });
    await insertRawEvent(pool, {
      event: discordDuplicate,
      payloadSha256: payloadHash(discordDuplicate),
      sourceConfigId: null,
    });
    const thirdResult = await processNextEvent(pool, {
      provider: null,
      onExactDuplicate,
    });
    expect(thirdResult).toMatchObject({
      disposition: "processed",
      created: false,
      outboxCreated: false,
    });
    expect(onExactDuplicate).toHaveBeenCalledWith(
      expect.objectContaining({
        channelId: "456",
        messageId: "101112",
      }),
    );

    const opportunities = await pool.query<CountRow>(
      "SELECT count(*)::int AS count FROM aggregator.opportunities",
    );
    const sources = await pool.query<CountRow>(
      "SELECT count(*)::int AS count FROM aggregator.opportunity_sources",
    );
    const outbox = await pool.query<CountRow>(
      "SELECT count(*)::int AS count FROM aggregator.delivery_outbox",
    );
    expect(opportunities.rows[0]?.count).toBe(1);
    expect(sources.rows[0]?.count).toBe(3);
    expect(outbox.rows[0]?.count).toBe(1);
  });

  it("keeps distinct roles at one company separate", async () => {
    const swe = opportunityRow({
      sourceEventId: "role-swe",
      company: "Example Corp",
      role: "Software Engineering Intern",
      applicationUrl: "https://jobs.lever.co/example/swe-1",
    });
    const pm = opportunityRow({
      sourceEventId: "role-pm",
      company: "Example Corp",
      role: "Product Management Intern",
      applicationUrl: "https://jobs.lever.co/example/pm-1",
    });
    await insertRawEvent(pool, {
      event: swe,
      payloadSha256: payloadHash(swe),
      sourceConfigId: null,
    });
    await insertRawEvent(pool, {
      event: pm,
      payloadSha256: payloadHash(pm),
      sourceConfigId: null,
    });

    await processNextEvent(pool, { provider: null });
    await processNextEvent(pool, { provider: null });
    const opportunities = await pool.query<CountRow>(
      "SELECT count(*)::int AS count FROM aggregator.opportunities",
    );
    expect(opportunities.rows[0]?.count).toBe(2);
  });

  it("routes fuzzy duplicates to review without suppressing them", async () => {
    await createOpportunity(pool, {
      company: "Example Corporation",
      role: "Software Engineer Internship",
      locations: ["Remote US"],
      season: "summer",
      year: 2027,
      employmentType: "internship",
      sponsorshipStatus: "unknown",
      applicationUrl: "https://jobs.lever.co/example/existing",
      deadline: null,
      postedAt: null,
      sourceUrl: null,
      descriptionExcerpt: null,
      evidence: { company: "Example Corporation" },
      canonicalUrl: "https://jobs.lever.co/example/existing",
      canonicalUrlHash: "c".repeat(64),
      fingerprint: "existing-fingerprint",
      normalizedCompany: "example",
      normalizedRole: "software engineer intern",
      status: "active",
      confidence: 0.99,
      needsReview: false,
    });

    const event = opportunityRow({
      sourceEventId: "fuzzy-review",
      company: "Example Corp",
      role: "Software Engineering Intern",
      applicationUrl: "https://jobs.lever.co/example/fuzzy-new",
    });
    await insertRawEvent(pool, {
      event,
      payloadSha256: payloadHash(event),
      sourceConfigId: null,
    });

    await expect(processNextEvent(pool, { provider: null })).resolves.toEqual(
      expect.objectContaining({
        disposition: "review",
        reviewReasons: ["fuzzy_duplicate"],
        created: true,
        outboxCreated: true,
      }),
    );
    const outbox = await pool.query<{
      count: number;
      destination_type: string;
    }>(
      `
        SELECT count(*)::int AS count, max(destination_type) AS destination_type
        FROM aggregator.delivery_outbox
      `,
    );
    expect(outbox.rows[0]?.count).toBe(1);
    expect(outbox.rows[0]?.destination_type).toBe("discord_review");
  });

  it("stores closed opportunities without enqueueing delivery", async () => {
    const event = opportunityRow({
      sourceEventId: "closed-row",
      company: "Example Corp",
      role: "Software Engineering Intern",
      applicationUrl: "https://jobs.lever.co/example/closed-1",
      closed: true,
    });
    await insertRawEvent(pool, {
      event,
      payloadSha256: payloadHash(event),
      sourceConfigId: null,
    });

    await expect(processNextEvent(pool, { provider: null })).resolves.toEqual(
      expect.objectContaining({
        disposition: "processed",
        created: true,
        outboxCreated: false,
      }),
    );
    const status = await pool.query<{ status: string }>(
      "SELECT status FROM aggregator.opportunities",
    );
    const outbox = await pool.query<CountRow>(
      "SELECT count(*)::int AS count FROM aggregator.delivery_outbox",
    );
    expect(status.rows[0]?.status).toBe("closed");
    expect(outbox.rows[0]?.count).toBe(0);
  });

  it("rejects hallucinated application URLs into review", async () => {
    const event = createRawEventFixture({
      source_event_id: "hallucinated-url",
      text: "Internship applications are open at Example Corp for Software Engineering Intern in Remote US for Summer 2027.",
    });
    await insertRawEvent(pool, {
      event,
      payloadSha256: payloadHash(event),
      sourceConfigId: null,
    });

    const work = await claimNextRawEvent(pool);
    expect(work).not.toBeNull();
    const result = await processWorkItem(pool, work!, {
      provider: {
        extract: () =>
          Promise.resolve({
            candidate: {
              schema_version: 1 as const,
              company: "Example Corp",
              role: "Software Engineering Intern",
              locations: ["Remote US"],
              season: "summer" as const,
              year: 2027,
              employment_type: "internship" as const,
              sponsorship_status: "unknown" as const,
              application_url: "https://hallucinated.example/jobs/1",
              deadline: null,
              posted_at: null,
              source_url: null,
              description_excerpt: null,
              confidence: 0.99,
              evidence: {
                company: "Example Corp",
                role: "Software Engineering Intern",
                locations: "Remote US",
                season: "Summer",
                year: "2027",
                employment_type: "Internship",
                application_url: "https://hallucinated.example/jobs/1",
              },
            },
            provider: "fake",
            model: "fake-v1",
            promptVersion: "test",
            latencyMs: 1,
            usage: {
              inputTokens: 1,
              outputTokens: 1,
              estimatedCostUsd: 0,
            },
          }),
      },
    });
    expect(result).toMatchObject({
      disposition: "review",
      reviewReasons: ["invalid_evidence"],
      created: true,
      outboxCreated: true,
    });
    const outbox = await pool.query<{ destination_type: string }>(
      "SELECT destination_type FROM aggregator.delivery_outbox",
    );
    expect(outbox.rows[0]?.destination_type).toBe("discord_review");
  });

  it("reclaims expired leases and remains idempotent after retry", async () => {
    const event = opportunityRow({
      sourceEventId: "lease-retry",
      company: "Example Corp",
      role: "Software Engineering Intern",
      applicationUrl: "https://jobs.lever.co/example/retry-1",
    });
    await insertRawEvent(pool, {
      event,
      payloadSha256: payloadHash(event),
      sourceConfigId: null,
    });

    const firstClaim = await claimNextRawEvent(pool, { leaseSeconds: 1 });
    expect(firstClaim).not.toBeNull();
    await pool.query(
      `
        UPDATE aggregator.raw_events
        SET lease_expires_at = now() - interval '1 second'
        WHERE id = $1
      `,
      [firstClaim!.rawEventId],
    );

    const result = await processNextEvent(pool, { provider: null });
    expect(result).toMatchObject({
      disposition: "processed",
      created: true,
      outboxCreated: true,
    });

    const duplicate = opportunityRow({
      sourceEventId: "lease-retry-duplicate-source",
      company: "Example Corp",
      role: "Software Engineering Intern",
      applicationUrl: "https://jobs.lever.co/example/retry-1?utm_source=retry",
    });
    await insertRawEvent(pool, {
      event: duplicate,
      payloadSha256: payloadHash(duplicate),
      sourceConfigId: null,
    });
    await expect(processNextEvent(pool, { provider: null })).resolves.toEqual(
      expect.objectContaining({
        disposition: "processed",
        created: false,
        outboxCreated: false,
      }),
    );
  });

  it("rolls back partial opportunity state when the processing run cannot finish", async () => {
    const event = opportunityRow({
      sourceEventId: "atomic-rollback",
      company: "Example Corp",
      role: "Software Engineering Intern",
      applicationUrl: "https://jobs.lever.co/example/atomic-1",
    });
    await insertRawEvent(pool, {
      event,
      payloadSha256: payloadHash(event),
      sourceConfigId: null,
    });
    const work = await claimNextRawEvent(pool);
    expect(work).not.toBeNull();

    await expect(
      persistProcessedOpportunity(pool, {
        rawEventId: work!.rawEventId,
        processingRunId: "00000000-0000-4000-8000-000000000000",
        leaseToken: work!.leaseToken,
        opportunity: {
          company: "Example Corp",
          role: "Software Engineering Intern",
          locations: ["Remote US"],
          season: "summer",
          year: 2027,
          employmentType: "internship",
          sponsorshipStatus: "unknown",
          applicationUrl: "https://jobs.lever.co/example/atomic-1",
          deadline: null,
          postedAt: null,
          sourceUrl: event.source_url,
          descriptionExcerpt: null,
          evidence: { company: "Example Corp" },
          canonicalUrl: "https://jobs.lever.co/example/atomic-1",
          canonicalUrlHash: "d".repeat(64),
          fingerprint: "atomic-fingerprint",
          stableJobBoard: "lever",
          stableJobId: "atomic-1",
          normalizedCompany: "example",
          normalizedRole: "software engineer intern",
          status: "active",
          confidence: 0.99,
          needsReview: false,
        },
        observedAt: event.captured_at,
        audit: {
          deterministicParserVersion: "test",
          modelProvider: null,
          modelName: null,
          promptVersion: null,
          inputTokens: null,
          outputTokens: null,
          costUsd: null,
          modelLatencyMs: null,
          classification: null,
          validationOutcome: null,
          extractionResult: null,
        },
        destinationKey: "internship-feed",
        outboxPayload: { company: "Example Corp" },
      }),
    ).rejects.toThrow();

    const opportunities = await pool.query<CountRow>(
      "SELECT count(*)::int AS count FROM aggregator.opportunities",
    );
    const outbox = await pool.query<CountRow>(
      "SELECT count(*)::int AS count FROM aggregator.delivery_outbox",
    );
    const raw = await pool.query<{ status: string }>(
      "SELECT status FROM aggregator.raw_events",
    );
    expect(opportunities.rows[0]?.count).toBe(0);
    expect(outbox.rows[0]?.count).toBe(0);
    expect(raw.rows[0]?.status).toBe("processing");
  });

  it("ignores irrelevant noise without creating opportunities", async () => {
    const event = createRawEventFixture({
      source_event_id: "noise",
      text: "Community meetup tonight in the lounge.",
    });
    await insertRawEvent(pool, {
      event,
      payloadSha256: payloadHash(event),
      sourceConfigId: null,
    });
    await expect(processNextEvent(pool, { provider: null })).resolves.toEqual(
      expect.objectContaining({ disposition: "ignored" }),
    );
    const opportunities = await pool.query<CountRow>(
      "SELECT count(*)::int AS count FROM aggregator.opportunities",
    );
    expect(opportunities.rows[0]?.count).toBe(0);
  });
});

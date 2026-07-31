import { createHash } from "node:crypto";
import type { RawEvent } from "@recruiting-help/contracts";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  createDatabasePool,
  createOpportunity,
  enqueueDelivery,
  insertRawEvent,
  migrateToLatest,
  persistSignedRawEvent,
  rollbackAllForDevelopment,
  type Pool,
} from "./index.js";
import {
  assertTestDatabaseUrl,
  createRawEventFixture,
  resetTestDatabase,
} from "./testing.js";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;

function makeRawEvent(
  sourceEventId: string,
  sourceAccount = "vanshb03/Summer2027-Internships",
): RawEvent {
  return createRawEventFixture({
    source_account: sourceAccount,
    source_event_id: sourceEventId,
  });
}

function payloadHash(event: RawEvent): string {
  return createHash("sha256").update(JSON.stringify(event)).digest("hex");
}

function nonceExpiry(): Date {
  return new Date(Date.now() + 10 * 60 * 1_000);
}

const describeWithDatabase =
  testDatabaseUrl === undefined ? describe.skip : describe;

describeWithDatabase("database integration", () => {
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

  it("recreates the schema from scratch and applies each migration once", async () => {
    expect(
      await rollbackAllForDevelopment(pool, { confirmDestructive: true }),
    ).toEqual([
      "0004_delivery_leases",
      "0003_expand_employment_types",
      "0002_processing_core",
      "0001_initial_schema",
    ]);
    expect(await migrateToLatest(pool)).toEqual([
      "0001_initial_schema",
      "0002_processing_core",
      "0003_expand_employment_types",
      "0004_delivery_leases",
    ]);
    expect(await migrateToLatest(pool)).toEqual([]);

    const result = await pool.query<{ table_name: string }>(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'aggregator'
      ORDER BY table_name
    `);
    expect(result.rows.map(({ table_name }) => table_name)).toEqual([
      "connector_health",
      "delivery_outbox",
      "opportunities",
      "opportunity_sources",
      "processing_runs",
      "raw_events",
      "source_configs",
      "source_cursors",
      "webhook_nonces",
    ]);
  });

  it("returns one raw event under concurrent duplicate inserts", async () => {
    const event = makeRawEvent("concurrent-event");
    const results = await Promise.all(
      Array.from({ length: 12 }, () =>
        insertRawEvent(pool, {
          event,
          payloadSha256: payloadHash(event),
          sourceConfigId: null,
        }),
      ),
    );

    expect(results.filter(({ inserted }) => inserted)).toHaveLength(1);
    expect(new Set(results.map(({ record }) => record.id)).size).toBe(1);
    const count = await pool.query<{ count: string }>(
      "SELECT count(*) FROM aggregator.raw_events",
    );
    expect(count.rows[0]?.count).toBe("1");
  });

  it("atomically rejects nonce replay and accepts event retries with fresh nonces", async () => {
    const event = makeRawEvent("signed-intake-event");
    const first = await persistSignedRawEvent(pool, {
      callerId: "collector-dev",
      nonce: "nonce_12345678901234567890",
      nonceExpiresAt: nonceExpiry(),
      event,
      payloadSha256: payloadHash(event),
    });
    expect(first).toMatchObject({ kind: "accepted", inserted: true });

    await expect(
      persistSignedRawEvent(pool, {
        callerId: "collector-dev",
        nonce: "nonce_12345678901234567890",
        nonceExpiresAt: nonceExpiry(),
        event,
        payloadSha256: payloadHash(event),
      }),
    ).resolves.toEqual({ kind: "replayed_nonce" });

    await expect(
      persistSignedRawEvent(pool, {
        callerId: "collector-dev",
        nonce: "fresh_nonce_123456789012345",
        nonceExpiresAt: nonceExpiry(),
        event,
        payloadSha256: payloadHash(event),
      }),
    ).resolves.toMatchObject({
      kind: "accepted",
      inserted: false,
      rawEventId: first.kind === "accepted" ? first.rawEventId : "unreachable",
    });
  });

  it("rolls back nonce consumption when raw-event persistence fails", async () => {
    const event = makeRawEvent("failed-persistence-event");
    await expect(
      persistSignedRawEvent(pool, {
        callerId: "collector-dev",
        nonce: "rollback_nonce_1234567890123",
        nonceExpiresAt: nonceExpiry(),
        event,
        payloadSha256: "invalid-hash",
      }),
    ).rejects.toMatchObject({ code: "23514" });

    const count = await pool.query<{ count: string }>(
      `
        SELECT count(*)
        FROM aggregator.webhook_nonces
        WHERE caller_id = $1 AND nonce = $2
      `,
      ["collector-dev", "rollback_nonce_1234567890123"],
    );
    expect(count.rows[0]?.count).toBe("0");
  });

  it("stores hostile source strings as data through parameterized queries", async () => {
    const hostileAccount = "repo'); DROP SCHEMA aggregator CASCADE; --";
    const event = makeRawEvent("hostile-event", hostileAccount);
    await insertRawEvent(pool, {
      event,
      payloadSha256: payloadHash(event),
      sourceConfigId: null,
    });

    const result = await pool.query<{ source_account: string }>(
      "SELECT source_account FROM aggregator.raw_events",
    );
    expect(result.rows[0]?.source_account).toBe(hostileAccount);

    const schemaResult = await pool.query<{ exists: boolean }>(
      "SELECT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'aggregator') AS exists",
    );
    expect(schemaResult.rows[0]?.exists).toBe(true);
  });

  it("rejects invalid database status values", async () => {
    const event = makeRawEvent("invalid-status");
    const inserted = await insertRawEvent(pool, {
      event,
      payloadSha256: payloadHash(event),
      sourceConfigId: null,
    });

    await expect(
      pool.query("UPDATE aggregator.raw_events SET status = $1 WHERE id = $2", [
        "lost",
        inserted.record.id,
      ]),
    ).rejects.toMatchObject({ code: "23514" });
  });

  it("grants application and read-only roles least-privilege table access", async () => {
    const result = await pool.query<{
      grantee: string;
      privilege_type: string;
    }>(`
      SELECT DISTINCT grantee, privilege_type
      FROM information_schema.role_table_grants
      WHERE table_schema = 'aggregator'
        AND grantee IN ('aggregator_app', 'aggregator_readonly')
      ORDER BY grantee, privilege_type
    `);

    expect(
      result.rows
        .filter(({ grantee }) => grantee === "aggregator_app")
        .map(({ privilege_type }) => privilege_type),
    ).toEqual(["DELETE", "INSERT", "SELECT", "UPDATE"]);
    expect(
      result.rows
        .filter(({ grantee }) => grantee === "aggregator_readonly")
        .map(({ privilege_type }) => privilege_type),
    ).toEqual(["SELECT"]);
  });

  it("creates only one outbox row under concurrent enqueue attempts", async () => {
    const opportunity = await createOpportunity(pool, {
      company: "Example Corp",
      role: "Software Engineering Intern",
      locations: ["Remote US"],
      season: "summer",
      year: 2027,
      employmentType: "internship",
      sponsorshipStatus: "unknown",
      applicationUrl: "https://example.com/jobs/123",
      deadline: null,
      postedAt: null,
      sourceUrl: "https://example.com/source",
      descriptionExcerpt: null,
      evidence: { company: "Example Corp" },
      canonicalUrl: "https://example.com/jobs/123",
      canonicalUrlHash: "b".repeat(64),
      fingerprint: "example|software-engineering-intern|remote-us",
      status: "active",
      confidence: 0.95,
      needsReview: false,
    });

    const results = await Promise.all(
      Array.from({ length: 12 }, () =>
        enqueueDelivery(pool, {
          opportunityId: opportunity.id,
          destinationType: "discord_feed",
          destinationKey: "internship-feed",
          payload: { content: "Example Corp" },
        }),
      ),
    );

    expect(results.filter(({ inserted }) => inserted)).toHaveLength(1);
    expect(new Set(results.map(({ record }) => record.id)).size).toBe(1);
    const count = await pool.query<{ count: string }>(
      "SELECT count(*) FROM aggregator.delivery_outbox",
    );
    expect(count.rows[0]?.count).toBe("1");
  });
});

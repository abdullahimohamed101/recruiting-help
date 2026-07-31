import { createHash } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  claimNextDelivery,
  createDatabasePool,
  createOpportunity,
  enqueueDelivery,
  markDeliveryDead,
  markDeliveryDelivered,
  markDeliveryRetry,
  migrateToLatest,
  type Pool,
} from "./index.js";
import { assertTestDatabaseUrl, resetTestDatabase } from "./testing.js";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const describeWithDatabase =
  testDatabaseUrl === undefined ? describe.skip : describe;

async function seedPendingDelivery(pool: Pool, key: string): Promise<string> {
  const canonicalUrl = `https://jobs.lever.co/example/${key}`;
  const opportunity = await createOpportunity(pool, {
    company: "Example Corp",
    role: "Software Engineering Intern",
    locations: ["Remote US"],
    season: "summer",
    year: 2027,
    employmentType: "internship",
    sponsorshipStatus: "unknown",
    applicationUrl: canonicalUrl,
    deadline: null,
    postedAt: null,
    sourceUrl: null,
    descriptionExcerpt: null,
    evidence: { company: "Example Corp" },
    canonicalUrl,
    canonicalUrlHash: createHash("sha256").update(canonicalUrl).digest("hex"),
    fingerprint: createHash("sha256")
      .update(`fingerprint-${key}`)
      .digest("hex"),
    status: "active",
    confidence: 0.99,
    needsReview: false,
  });
  const delivery = await enqueueDelivery(pool, {
    opportunityId: opportunity.id,
    destinationType: "discord_feed",
    destinationKey: "internship-feed",
    payload: { company: "Example Corp", role: "Software Engineering Intern" },
  });
  return delivery.record.id;
}

describeWithDatabase("delivery outbox integration", () => {
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

  it("claims exactly one delivery under concurrent workers", async () => {
    await seedPendingDelivery(pool, "claim-concurrent");
    const claims = await Promise.all(
      Array.from({ length: 8 }, () => claimNextDelivery(pool)),
    );
    expect(claims.filter((claim) => claim !== null)).toHaveLength(1);
  });

  it("marks a delivery delivered with an external message id", async () => {
    await seedPendingDelivery(pool, "delivered");
    const work = await claimNextDelivery(pool);
    expect(work).not.toBeNull();
    await markDeliveryDelivered(pool, {
      deliveryId: work!.deliveryId,
      leaseToken: work!.leaseToken,
      externalMessageId: "discord-message-123",
    });
    const row = await pool.query<{
      status: string;
      external_message_id: string | null;
    }>("SELECT status, external_message_id FROM aggregator.delivery_outbox");
    expect(row.rows[0]).toEqual({
      status: "delivered",
      external_message_id: "discord-message-123",
    });
  });

  it("retries with backoff and can mark permanent failures dead", async () => {
    await seedPendingDelivery(pool, "retry-dead");
    const first = await claimNextDelivery(pool);
    expect(first).not.toBeNull();
    await markDeliveryRetry(pool, {
      deliveryId: first!.deliveryId,
      leaseToken: first!.leaseToken,
      attemptCount: first!.attemptCount,
      error: "rate_limited",
      retryAfterSeconds: 1,
    });
    const retryRow = await pool.query<{ status: string }>(
      "SELECT status FROM aggregator.delivery_outbox",
    );
    expect(retryRow.rows[0]?.status).toBe("retry");

    await pool.query(
      `
        UPDATE aggregator.delivery_outbox
        SET next_attempt_at = now() - interval '1 second'
      `,
    );
    const second = await claimNextDelivery(pool);
    expect(second).not.toBeNull();
    await markDeliveryDead(pool, {
      deliveryId: second!.deliveryId,
      leaseToken: second!.leaseToken,
      error: "permanent_4xx",
    });
    const deadRow = await pool.query<{ status: string }>(
      "SELECT status FROM aggregator.delivery_outbox",
    );
    expect(deadRow.rows[0]?.status).toBe("dead");
  });

  it("does not leave a delivered row when the lease is lost", async () => {
    await seedPendingDelivery(pool, "lease-lost");
    const work = await claimNextDelivery(pool);
    expect(work).not.toBeNull();
    await expect(
      markDeliveryDelivered(pool, {
        deliveryId: work!.deliveryId,
        leaseToken: "00000000-0000-4000-8000-000000000000",
        externalMessageId: "should-not-persist",
      }),
    ).rejects.toThrow(/lease/i);
    const row = await pool.query<{
      status: string;
      external_message_id: string | null;
    }>("SELECT status, external_message_id FROM aggregator.delivery_outbox");
    expect(row.rows[0]?.status).toBe("delivering");
    expect(row.rows[0]?.external_message_id).toBeNull();
  });
});

import { randomUUID } from "node:crypto";
import {
  RawEventSchema,
  type RawEvent,
  type ReviewReason,
} from "@recruiting-help/contracts";
import type { Pool, PoolClient } from "pg";
import {
  createOpportunity,
  enqueueDelivery,
  linkOpportunitySource,
  type CreateOpportunityInput,
} from "./repositories.js";

export type ProcessingWorkItem = {
  rawEventId: string;
  processingRunId: string;
  leaseToken: string;
  attemptCount: number;
  event: RawEvent;
};

export type ProcessingAudit = {
  deterministicParserVersion: string | null;
  modelProvider: string | null;
  modelName: string | null;
  promptVersion: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  costUsd: number | null;
  modelLatencyMs: number | null;
  classification: Record<string, unknown> | null;
  validationOutcome: Record<string, unknown> | null;
  extractionResult: Record<string, unknown> | null;
};

export type PreparedOpportunity = CreateOpportunityInput & {
  stableJobBoard: string | null;
  stableJobId: string | null;
  normalizedCompany: string | null;
  normalizedRole: string | null;
};

export type FuzzyOpportunityCandidate = {
  id: string;
  company: string;
  role: string;
  locations: string[];
  year: number | null;
  canonical_url_hash: string | null;
  fingerprint: string | null;
  stable_job_board: string | null;
  stable_job_id: string | null;
};

export class ProcessingLeaseLostError extends Error {
  constructor() {
    super("The raw-event processing lease is no longer owned by this worker.");
    this.name = "ProcessingLeaseLostError";
  }
}

async function withTransaction<T>(
  pool: Pool,
  action: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await action(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function claimNextRawEvent(
  pool: Pool,
  options: {
    leaseSeconds?: number;
    maxAttempts?: number;
  } = {},
): Promise<ProcessingWorkItem | null> {
  const leaseSeconds = options.leaseSeconds ?? 120;
  const maxAttempts = options.maxAttempts ?? 5;
  const leaseToken = randomUUID();

  return withTransaction(pool, async (client) => {
    const claimed = await client.query<{
      id: string;
      payload: unknown;
      attempt_count: number;
    }>(
      `
        WITH candidate AS (
          SELECT id
          FROM aggregator.raw_events
          WHERE attempt_count < $1
            AND (
              (
                status IN ('pending', 'failed')
                AND next_attempt_at <= now()
              )
              OR (
                status = 'processing'
                AND lease_expires_at <= now()
              )
            )
          ORDER BY created_at
          FOR UPDATE SKIP LOCKED
          LIMIT 1
        )
        UPDATE aggregator.raw_events AS event
        SET
          status = 'processing',
          attempt_count = event.attempt_count + 1,
          lease_expires_at = now() + make_interval(secs => $2),
          lease_token = $3,
          last_error_code = NULL,
          last_error_detail = NULL
        FROM candidate
        WHERE event.id = candidate.id
        RETURNING event.id, event.payload, event.attempt_count
      `,
      [maxAttempts, leaseSeconds, leaseToken],
    );
    const row = claimed.rows[0];
    if (row === undefined) {
      return null;
    }

    const run = await client.query<{ id: string }>(
      `
        INSERT INTO aggregator.processing_runs (raw_event_id, status)
        VALUES ($1, 'started')
        RETURNING id
      `,
      [row.id],
    );
    const processingRunId = run.rows[0]?.id;
    if (processingRunId === undefined) {
      throw new Error("Processing-run insert returned no row.");
    }

    return {
      rawEventId: row.id,
      processingRunId,
      leaseToken,
      attemptCount: row.attempt_count,
      event: RawEventSchema.parse(row.payload),
    };
  });
}

async function assertLease(
  client: PoolClient,
  input: Pick<ProcessingWorkItem, "rawEventId" | "leaseToken">,
): Promise<void> {
  const result = await client.query(
    `
      SELECT id
      FROM aggregator.raw_events
      WHERE id = $1
        AND status = 'processing'
        AND lease_token = $2
      FOR UPDATE
    `,
    [input.rawEventId, input.leaseToken],
  );
  if (result.rowCount !== 1) {
    throw new ProcessingLeaseLostError();
  }
}

async function finishRun(
  client: PoolClient,
  input: {
    processingRunId: string;
    opportunityId: string | null;
    status: "succeeded" | "failed" | "review";
    reviewReasons: ReviewReason[];
    audit: ProcessingAudit;
    errorCategory?: string | null;
  },
): Promise<void> {
  const result = await client.query(
    `
      UPDATE aggregator.processing_runs
      SET
        opportunity_id = $2,
        status = $3,
        deterministic_parser_version = $4,
        model_provider = $5,
        model_name = $6,
        prompt_version = $7,
        input_tokens = $8,
        output_tokens = $9,
        cost_usd = $10,
        classification = $11::jsonb,
        validation_outcome = $12::jsonb,
        review_reasons = $13,
        extraction_result = $14::jsonb,
        model_latency_ms = $15,
        error_category = $16,
        completed_at = now()
      WHERE id = $1
        AND status = 'started'
    `,
    [
      input.processingRunId,
      input.opportunityId,
      input.status,
      input.audit.deterministicParserVersion,
      input.audit.modelProvider,
      input.audit.modelName,
      input.audit.promptVersion,
      input.audit.inputTokens,
      input.audit.outputTokens,
      input.audit.costUsd,
      input.audit.classification === null
        ? null
        : JSON.stringify(input.audit.classification),
      input.audit.validationOutcome === null
        ? null
        : JSON.stringify(input.audit.validationOutcome),
      input.reviewReasons,
      input.audit.extractionResult === null
        ? null
        : JSON.stringify(input.audit.extractionResult),
      input.audit.modelLatencyMs,
      input.errorCategory ?? null,
    ],
  );
  if (result.rowCount !== 1) {
    throw new Error("Processing run was not in the started state.");
  }
}

export async function completeRawEventWithoutOpportunity(
  pool: Pool,
  input: Pick<
    ProcessingWorkItem,
    "rawEventId" | "processingRunId" | "leaseToken"
  > & {
    disposition: "ignored" | "review";
    reviewReasons: ReviewReason[];
    audit: ProcessingAudit;
  },
): Promise<void> {
  await withTransaction(pool, async (client) => {
    await assertLease(client, input);
    const updated = await client.query(
      `
        UPDATE aggregator.raw_events
        SET
          status = $3,
          lease_expires_at = NULL,
          lease_token = NULL
        WHERE id = $1 AND lease_token = $2
      `,
      [input.rawEventId, input.leaseToken, input.disposition],
    );
    if (updated.rowCount !== 1) {
      throw new ProcessingLeaseLostError();
    }
    await finishRun(client, {
      processingRunId: input.processingRunId,
      opportunityId: null,
      status: input.disposition === "review" ? "review" : "succeeded",
      reviewReasons: input.reviewReasons,
      audit: input.audit,
    });
  });
}

export async function failRawEventProcessing(
  pool: Pool,
  input: Pick<
    ProcessingWorkItem,
    "rawEventId" | "processingRunId" | "leaseToken" | "attemptCount"
  > & {
    errorCode: string;
    errorDetail: string;
    audit: ProcessingAudit;
  },
): Promise<void> {
  const retrySeconds = Math.min(3_600, 30 * 2 ** (input.attemptCount - 1));
  await withTransaction(pool, async (client) => {
    await assertLease(client, input);
    await client.query(
      `
        UPDATE aggregator.raw_events
        SET
          status = 'failed',
          lease_expires_at = NULL,
          lease_token = NULL,
          next_attempt_at = now() + make_interval(secs => $3),
          last_error_code = $4,
          last_error_detail = $5
        WHERE id = $1 AND lease_token = $2
      `,
      [
        input.rawEventId,
        input.leaseToken,
        retrySeconds,
        input.errorCode,
        input.errorDetail,
      ],
    );
    await finishRun(client, {
      processingRunId: input.processingRunId,
      opportunityId: null,
      status: "failed",
      reviewReasons: [],
      audit: input.audit,
      errorCategory: input.errorCode,
    });
  });
}

export async function findFuzzyOpportunityCandidates(
  pool: Pool,
  input: { year: number | null; limit?: number },
): Promise<FuzzyOpportunityCandidate[]> {
  const result = await pool.query<FuzzyOpportunityCandidate>(
    `
      SELECT
        id,
        company,
        role,
        locations,
        year,
        canonical_url_hash,
        fingerprint,
        stable_job_board,
        stable_job_id
      FROM aggregator.opportunities
      WHERE status = 'active'
        AND company IS NOT NULL
        AND role IS NOT NULL
        AND ($1::integer IS NULL OR year = $1)
      ORDER BY last_seen_at DESC
      LIMIT $2
    `,
    [input.year, input.limit ?? 500],
  );
  return result.rows;
}

export type PersistProcessedOpportunityResult = {
  opportunityId: string;
  created: boolean;
  outboxCreated: boolean;
};

export async function persistProcessedOpportunity(
  pool: Pool,
  input: Pick<
    ProcessingWorkItem,
    "rawEventId" | "processingRunId" | "leaseToken"
  > & {
    opportunity: PreparedOpportunity;
    observedAt: string;
    audit: ProcessingAudit;
    destinationKey: string;
    outboxPayload: Record<string, unknown>;
    enqueueOutbox?: boolean;
  },
): Promise<PersistProcessedOpportunityResult> {
  return withTransaction(pool, async (client) => {
    await assertLease(client, input);
    const dedupeKeys = [
      input.opportunity.canonicalUrlHash,
      input.opportunity.stableJobBoard !== null &&
      input.opportunity.stableJobId !== null
        ? `${input.opportunity.stableJobBoard}:${input.opportunity.stableJobId}`
        : null,
      input.opportunity.fingerprint,
    ].filter((value): value is string => value !== null);
    const lockKeys = [
      ...new Set(dedupeKeys.length === 0 ? [input.rawEventId] : dedupeKeys),
    ].sort();
    for (const lockKey of lockKeys) {
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
        [lockKey],
      );
    }

    const existing = await client.query<{ id: string }>(
      `
        SELECT id
        FROM aggregator.opportunities
        WHERE
          ($1::text IS NOT NULL AND canonical_url_hash = $1)
          OR (
            $2::text IS NOT NULL
            AND $3::text IS NOT NULL
            AND stable_job_board = $2
            AND stable_job_id = $3
          )
          OR (
            $4::text IS NOT NULL
            AND fingerprint = $4
          )
        ORDER BY
          CASE WHEN canonical_url_hash = $1 THEN 1 ELSE 2 END,
          created_at
        LIMIT 1
        FOR UPDATE
      `,
      [
        input.opportunity.canonicalUrlHash,
        input.opportunity.stableJobBoard,
        input.opportunity.stableJobId,
        input.opportunity.fingerprint,
      ],
    );

    let opportunityId = existing.rows[0]?.id;
    let created = false;
    let outboxCreated = false;
    if (opportunityId === undefined) {
      const opportunity = await createOpportunity(client, input.opportunity);
      opportunityId = opportunity.id;
      created = true;
      if (
        input.enqueueOutbox !== false &&
        input.opportunity.status === "active"
      ) {
        const delivery = await enqueueDelivery(client, {
          opportunityId,
          destinationType: "discord_feed",
          destinationKey: input.destinationKey,
          payload: input.outboxPayload,
        });
        outboxCreated = delivery.inserted;
      }
    } else {
      await client.query(
        `
          UPDATE aggregator.opportunities
          SET last_seen_at = GREATEST(last_seen_at, $2::timestamptz)
          WHERE id = $1
        `,
        [opportunityId, input.observedAt],
      );
    }

    await linkOpportunitySource(client, {
      opportunityId,
      rawEventId: input.rawEventId,
      sourceUrl: input.opportunity.sourceUrl,
      observedAt: input.observedAt,
    });
    await client.query(
      `
        UPDATE aggregator.raw_events
        SET
          status = 'processed',
          lease_expires_at = NULL,
          lease_token = NULL
        WHERE id = $1 AND lease_token = $2
      `,
      [input.rawEventId, input.leaseToken],
    );
    await finishRun(client, {
      processingRunId: input.processingRunId,
      opportunityId,
      status: "succeeded",
      reviewReasons: [],
      audit: input.audit,
    });

    return { opportunityId, created, outboxCreated };
  });
}

export async function persistReviewOpportunity(
  pool: Pool,
  input: Pick<
    ProcessingWorkItem,
    "rawEventId" | "processingRunId" | "leaseToken"
  > & {
    opportunity: PreparedOpportunity;
    observedAt: string;
    audit: ProcessingAudit;
    reviewReasons: ReviewReason[];
    destinationKey?: string;
    outboxPayload: Record<string, unknown>;
  },
): Promise<PersistProcessedOpportunityResult> {
  return withTransaction(pool, async (client) => {
    await assertLease(client, input);
    const reviewOpportunity: PreparedOpportunity = {
      ...input.opportunity,
      needsReview: true,
      status: "active",
    };
    const opportunity = await createOpportunity(client, reviewOpportunity);
    const delivery = await enqueueDelivery(client, {
      opportunityId: opportunity.id,
      destinationType: "discord_review",
      destinationKey: input.destinationKey ?? "aggregator-review",
      payload: input.outboxPayload,
    });
    await linkOpportunitySource(client, {
      opportunityId: opportunity.id,
      rawEventId: input.rawEventId,
      sourceUrl: reviewOpportunity.sourceUrl,
      observedAt: input.observedAt,
    });
    const updated = await client.query(
      `
        UPDATE aggregator.raw_events
        SET
          status = 'review',
          lease_expires_at = NULL,
          lease_token = NULL
        WHERE id = $1 AND lease_token = $2
      `,
      [input.rawEventId, input.leaseToken],
    );
    if (updated.rowCount !== 1) {
      throw new ProcessingLeaseLostError();
    }
    await finishRun(client, {
      processingRunId: input.processingRunId,
      opportunityId: opportunity.id,
      status: "review",
      reviewReasons: input.reviewReasons,
      audit: input.audit,
    });
    return {
      opportunityId: opportunity.id,
      created: true,
      outboxCreated: delivery.inserted,
    };
  });
}

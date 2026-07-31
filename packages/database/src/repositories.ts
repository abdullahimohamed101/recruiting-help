import type {
  EmploymentType,
  OpportunityStatus,
  RawEvent,
  Season,
  SponsorshipStatus,
} from "@recruiting-help/contracts";
import type { Pool, PoolClient } from "pg";

type Queryable = Pool | PoolClient;

export type RawEventRecord = {
  id: string;
  source_type: RawEvent["source"];
  source_account: string;
  source_event_id: string;
  status: string;
  created_at: Date;
};

export type InsertRawEventInput = {
  event: RawEvent;
  payloadSha256: string;
  sourceConfigId: string | null;
};

export type InsertResult<T> = {
  record: T;
  inserted: boolean;
};

export async function insertRawEvent(
  database: Queryable,
  input: InsertRawEventInput,
): Promise<InsertResult<RawEventRecord>> {
  const { event, payloadSha256, sourceConfigId } = input;
  const insertResult = await database.query<RawEventRecord>(
    `
      INSERT INTO aggregator.raw_events (
        schema_version,
        source_config_id,
        source_type,
        source_account,
        source_event_id,
        source_url,
        occurred_at,
        captured_at,
        payload,
        payload_sha256
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10)
      ON CONFLICT (source_type, source_account, source_event_id) DO NOTHING
      RETURNING id, source_type, source_account, source_event_id, status, created_at
    `,
    [
      event.schema_version,
      sourceConfigId,
      event.source,
      event.source_account,
      event.source_event_id,
      event.source_url,
      event.occurred_at,
      event.captured_at,
      JSON.stringify(event),
      payloadSha256,
    ],
  );

  const insertedRecord = insertResult.rows[0];
  if (insertedRecord !== undefined) {
    return { record: insertedRecord, inserted: true };
  }

  const existingResult = await database.query<RawEventRecord>(
    `
      SELECT id, source_type, source_account, source_event_id, status, created_at
      FROM aggregator.raw_events
      WHERE source_type = $1
        AND source_account = $2
        AND source_event_id = $3
    `,
    [event.source, event.source_account, event.source_event_id],
  );
  const existingRecord = existingResult.rows[0];
  if (existingRecord === undefined) {
    throw new Error(
      "Raw-event conflict was reported but no existing row was found.",
    );
  }

  return { record: existingRecord, inserted: false };
}

export type CreateOpportunityInput = {
  company: string | null;
  role: string | null;
  locations: string[];
  season: Season | null;
  year: number | null;
  employmentType: EmploymentType | null;
  sponsorshipStatus: SponsorshipStatus;
  applicationUrl: string | null;
  deadline: string | null;
  postedAt: string | null;
  sourceUrl: string | null;
  descriptionExcerpt: string | null;
  evidence: Record<string, string>;
  canonicalUrl: string | null;
  canonicalUrlHash: string | null;
  fingerprint: string | null;
  stableJobBoard?: string | null;
  stableJobId?: string | null;
  normalizedCompany?: string | null;
  normalizedRole?: string | null;
  status: OpportunityStatus;
  confidence: number;
  needsReview: boolean;
};

export type OpportunityRecord = {
  id: string;
  company: string | null;
  role: string | null;
  canonical_url_hash: string | null;
  status: OpportunityStatus;
};

export async function createOpportunity(
  database: Queryable,
  input: CreateOpportunityInput,
): Promise<OpportunityRecord> {
  const result = await database.query<OpportunityRecord>(
    `
      INSERT INTO aggregator.opportunities (
        company,
        role,
        locations,
        season,
        year,
        employment_type,
        sponsorship_status,
        application_url,
        deadline,
        posted_at,
        source_url,
        description_excerpt,
        evidence,
        canonical_url,
        canonical_url_hash,
        fingerprint,
        stable_job_board,
        stable_job_id,
        normalized_company,
        normalized_role,
        status,
        confidence,
        needs_review
      )
      VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
        $11, $12, $13::jsonb, $14, $15, $16, $17, $18, $19,
        $20, $21, $22, $23
      )
      RETURNING id, company, role, canonical_url_hash, status
    `,
    [
      input.company,
      input.role,
      input.locations,
      input.season,
      input.year,
      input.employmentType,
      input.sponsorshipStatus,
      input.applicationUrl,
      input.deadline,
      input.postedAt,
      input.sourceUrl,
      input.descriptionExcerpt,
      JSON.stringify(input.evidence),
      input.canonicalUrl,
      input.canonicalUrlHash,
      input.fingerprint,
      input.stableJobBoard ?? null,
      input.stableJobId ?? null,
      input.normalizedCompany ?? null,
      input.normalizedRole ?? null,
      input.status,
      input.confidence,
      input.needsReview,
    ],
  );

  const record = result.rows[0];
  if (record === undefined) {
    throw new Error("Opportunity insert returned no row.");
  }
  return record;
}

export async function linkOpportunitySource(
  database: Queryable,
  input: {
    opportunityId: string;
    rawEventId: string;
    sourceUrl: string | null;
    observedAt: string;
  },
): Promise<boolean> {
  const result = await database.query(
    `
      INSERT INTO aggregator.opportunity_sources (
        opportunity_id,
        raw_event_id,
        source_url,
        observed_at
      )
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (raw_event_id) DO NOTHING
      RETURNING raw_event_id
    `,
    [input.opportunityId, input.rawEventId, input.sourceUrl, input.observedAt],
  );

  return result.rowCount === 1;
}

export type EnqueueDeliveryInput = {
  opportunityId: string;
  destinationType: "discord_feed" | "discord_review" | "notion";
  destinationKey: string;
  payload: Record<string, unknown>;
};

export type DeliveryRecord = {
  id: string;
  opportunity_id: string;
  destination_type: EnqueueDeliveryInput["destinationType"];
  destination_key: string;
  status: string;
};

export async function enqueueDelivery(
  database: Queryable,
  input: EnqueueDeliveryInput,
): Promise<InsertResult<DeliveryRecord>> {
  const insertResult = await database.query<DeliveryRecord>(
    `
      INSERT INTO aggregator.delivery_outbox (
        opportunity_id,
        destination_type,
        destination_key,
        payload
      )
      VALUES ($1, $2, $3, $4::jsonb)
      ON CONFLICT (opportunity_id, destination_type, destination_key) DO NOTHING
      RETURNING id, opportunity_id, destination_type, destination_key, status
    `,
    [
      input.opportunityId,
      input.destinationType,
      input.destinationKey,
      JSON.stringify(input.payload),
    ],
  );

  const insertedRecord = insertResult.rows[0];
  if (insertedRecord !== undefined) {
    return { record: insertedRecord, inserted: true };
  }

  const existingResult = await database.query<DeliveryRecord>(
    `
      SELECT id, opportunity_id, destination_type, destination_key, status
      FROM aggregator.delivery_outbox
      WHERE opportunity_id = $1
        AND destination_type = $2
        AND destination_key = $3
    `,
    [input.opportunityId, input.destinationType, input.destinationKey],
  );
  const existingRecord = existingResult.rows[0];
  if (existingRecord === undefined) {
    throw new Error(
      "Outbox conflict was reported but no existing row was found.",
    );
  }

  return { record: existingRecord, inserted: false };
}

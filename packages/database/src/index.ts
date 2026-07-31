import { Pool, type PoolConfig } from "pg";

export { migrateToLatest, rollbackAllForDevelopment } from "./migrations.js";
export {
  persistSignedRawEvent,
  type PersistSignedRawEventInput,
  type PersistSignedRawEventResult,
} from "./intake.js";
export {
  createOpportunity,
  enqueueDelivery,
  insertRawEvent,
  linkOpportunitySource,
  type CreateOpportunityInput,
  type EnqueueDeliveryInput,
  type InsertRawEventInput,
} from "./repositories.js";
export {
  ProcessingLeaseLostError,
  claimNextRawEvent,
  completeRawEventWithoutOpportunity,
  failRawEventProcessing,
  findFuzzyOpportunityCandidates,
  persistProcessedOpportunity,
  type FuzzyOpportunityCandidate,
  type PersistProcessedOpportunityResult,
  type PreparedOpportunity,
  type ProcessingAudit,
  type ProcessingWorkItem,
} from "./processing.js";

export function createDatabasePool(
  connectionString: string,
  overrides: PoolConfig = {},
): Pool {
  return new Pool({
    connectionString,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    ...overrides,
  });
}

export type { Pool, PoolClient } from "pg";

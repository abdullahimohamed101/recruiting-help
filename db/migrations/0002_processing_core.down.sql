ALTER TABLE aggregator.processing_runs
  DROP CONSTRAINT IF EXISTS processing_runs_review_reasons_check,
  DROP COLUMN IF EXISTS model_latency_ms,
  DROP COLUMN IF EXISTS extraction_result,
  DROP COLUMN IF EXISTS review_reasons;

DROP INDEX IF EXISTS aggregator.opportunities_fuzzy_candidates_idx;
DROP INDEX IF EXISTS aggregator.opportunities_stable_job_unique;

ALTER TABLE aggregator.opportunities
  DROP COLUMN IF EXISTS normalized_role,
  DROP COLUMN IF EXISTS normalized_company,
  DROP COLUMN IF EXISTS stable_job_id,
  DROP COLUMN IF EXISTS stable_job_board;

DROP INDEX IF EXISTS aggregator.raw_events_claim_idx;

ALTER TABLE aggregator.raw_events
  DROP CONSTRAINT IF EXISTS raw_events_processing_lease_token_check,
  DROP COLUMN IF EXISTS lease_token,
  DROP COLUMN IF EXISTS next_attempt_at;

CREATE INDEX raw_events_claim_idx
  ON aggregator.raw_events (status, created_at)
  WHERE status IN ('pending', 'failed');

ALTER TABLE aggregator.raw_events
  ADD COLUMN next_attempt_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN lease_token uuid;

UPDATE aggregator.raw_events
SET
  status = 'failed',
  lease_expires_at = NULL,
  last_error_code = 'lease_migration_recovered',
  last_error_detail = 'Processing lease reset during migration 0002.'
WHERE status = 'processing';

ALTER TABLE aggregator.raw_events
  ADD CONSTRAINT raw_events_processing_lease_token_check CHECK (
    (status = 'processing' AND lease_token IS NOT NULL)
    OR status <> 'processing'
  );

DROP INDEX aggregator.raw_events_claim_idx;
CREATE INDEX raw_events_claim_idx
  ON aggregator.raw_events (next_attempt_at, created_at)
  WHERE status IN ('pending', 'failed');

ALTER TABLE aggregator.opportunities
  ADD COLUMN stable_job_board text,
  ADD COLUMN stable_job_id text,
  ADD COLUMN normalized_company text,
  ADD COLUMN normalized_role text;

CREATE UNIQUE INDEX opportunities_stable_job_unique
  ON aggregator.opportunities (stable_job_board, stable_job_id)
  WHERE stable_job_board IS NOT NULL AND stable_job_id IS NOT NULL;

CREATE INDEX opportunities_fuzzy_candidates_idx
  ON aggregator.opportunities (year, normalized_company, status)
  WHERE status = 'active';

ALTER TABLE aggregator.processing_runs
  ADD COLUMN review_reasons text[] NOT NULL DEFAULT '{}',
  ADD COLUMN extraction_result jsonb,
  ADD COLUMN model_latency_ms integer CHECK (
    model_latency_ms IS NULL OR model_latency_ms >= 0
  );

ALTER TABLE aggregator.processing_runs
  ADD CONSTRAINT processing_runs_review_reasons_check CHECK (
    review_reasons <@ ARRAY[
      'missing_company',
      'missing_role',
      'missing_application_url',
      'ambiguous_year',
      'ambiguous_geography',
      'low_confidence',
      'fuzzy_duplicate',
      'invalid_evidence',
      'unsupported_opportunity',
      'ai_unavailable'
    ]::text[]
  );

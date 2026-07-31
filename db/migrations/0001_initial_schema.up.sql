CREATE SCHEMA IF NOT EXISTS aggregator;

DO $$
BEGIN
  CREATE ROLE aggregator_app NOLOGIN;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

DO $$
BEGIN
  CREATE ROLE aggregator_readonly NOLOGIN;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

CREATE FUNCTION aggregator.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END
$$;

CREATE TABLE aggregator.source_configs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_type text NOT NULL CHECK (
    source_type IN (
      'github',
      'discord_browser',
      'slack_api',
      'slack_browser',
      'instagram_browser',
      'discord_manual',
      'slack_manual',
      'instagram_manual'
    )
  ),
  display_name text NOT NULL CHECK (length(btrim(display_name)) > 0),
  config jsonb NOT NULL CHECK (jsonb_typeof(config) = 'object'),
  enabled boolean NOT NULL DEFAULT false,
  poll_interval_seconds integer NOT NULL CHECK (poll_interval_seconds >= 30),
  last_success_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX source_configs_display_name_unique
  ON aggregator.source_configs (lower(display_name));
CREATE INDEX source_configs_enabled_type_idx
  ON aggregator.source_configs (source_type, enabled)
  WHERE enabled;

CREATE TRIGGER source_configs_set_updated_at
BEFORE UPDATE ON aggregator.source_configs
FOR EACH ROW EXECUTE FUNCTION aggregator.set_updated_at();

CREATE TABLE aggregator.source_cursors (
  source_config_id uuid NOT NULL
    REFERENCES aggregator.source_configs(id) ON DELETE CASCADE,
  cursor_key text NOT NULL CHECK (length(btrim(cursor_key)) > 0),
  cursor_value jsonb NOT NULL,
  etag text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (source_config_id, cursor_key)
);

CREATE TRIGGER source_cursors_set_updated_at
BEFORE UPDATE ON aggregator.source_cursors
FOR EACH ROW EXECUTE FUNCTION aggregator.set_updated_at();

CREATE TABLE aggregator.connector_health (
  source_config_id uuid PRIMARY KEY
    REFERENCES aggregator.source_configs(id) ON DELETE CASCADE,
  state text NOT NULL DEFAULT 'disabled' CHECK (
    state IN (
      'healthy',
      'stale',
      'reauth_required',
      'selector_broken',
      'rate_limited',
      'disabled'
    )
  ),
  last_attempt_at timestamptz,
  last_success_at timestamptz,
  consecutive_failures integer NOT NULL DEFAULT 0 CHECK (consecutive_failures >= 0),
  detail_code text,
  detail text,
  checkpoint jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (last_success_at IS NULL OR last_attempt_at IS NULL OR last_success_at <= last_attempt_at)
);

CREATE INDEX connector_health_state_updated_idx
  ON aggregator.connector_health (state, updated_at);

CREATE TRIGGER connector_health_set_updated_at
BEFORE UPDATE ON aggregator.connector_health
FOR EACH ROW EXECUTE FUNCTION aggregator.set_updated_at();

CREATE TABLE aggregator.raw_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  schema_version smallint NOT NULL DEFAULT 1 CHECK (schema_version = 1),
  source_config_id uuid
    REFERENCES aggregator.source_configs(id) ON DELETE SET NULL,
  source_type text NOT NULL CHECK (
    source_type IN (
      'github',
      'discord_browser',
      'slack_api',
      'slack_browser',
      'instagram_browser',
      'discord_manual',
      'slack_manual',
      'instagram_manual'
    )
  ),
  source_account text NOT NULL CHECK (length(btrim(source_account)) > 0),
  source_event_id text NOT NULL CHECK (length(btrim(source_event_id)) > 0),
  source_url text,
  occurred_at timestamptz,
  captured_at timestamptz NOT NULL,
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  payload_sha256 text NOT NULL CHECK (payload_sha256 ~ '^[0-9a-f]{64}$'),
  status text NOT NULL DEFAULT 'pending' CHECK (
    status IN ('pending', 'processing', 'processed', 'review', 'ignored', 'failed')
  ),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  lease_expires_at timestamptz,
  last_error_code text,
  last_error_detail text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_type, source_account, source_event_id),
  CHECK (
    (status = 'processing' AND lease_expires_at IS NOT NULL)
    OR status <> 'processing'
  )
);

CREATE INDEX raw_events_claim_idx
  ON aggregator.raw_events (status, created_at)
  WHERE status IN ('pending', 'failed');
CREATE INDEX raw_events_expired_lease_idx
  ON aggregator.raw_events (lease_expires_at)
  WHERE status = 'processing';
CREATE INDEX raw_events_captured_at_idx
  ON aggregator.raw_events (captured_at);

CREATE TRIGGER raw_events_set_updated_at
BEFORE UPDATE ON aggregator.raw_events
FOR EACH ROW EXECUTE FUNCTION aggregator.set_updated_at();

CREATE TABLE aggregator.opportunities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  schema_version smallint NOT NULL DEFAULT 1 CHECK (schema_version = 1),
  company text,
  role text,
  locations text[] NOT NULL DEFAULT '{}',
  season text CHECK (season IS NULL OR season IN ('spring', 'summer', 'fall', 'winter')),
  year integer CHECK (year IS NULL OR year BETWEEN 2020 AND 2100),
  employment_type text CHECK (
    employment_type IS NULL OR employment_type IN ('internship', 'co_op')
  ),
  sponsorship_status text NOT NULL DEFAULT 'unknown' CHECK (
    sponsorship_status IN (
      'unknown',
      'offers_or_considers',
      'does_not_offer',
      'us_citizenship_required'
    )
  ),
  application_url text,
  deadline date,
  posted_at timestamptz,
  source_url text,
  description_excerpt text,
  evidence jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(evidence) = 'object'),
  canonical_url text,
  canonical_url_hash text CHECK (
    canonical_url_hash IS NULL OR canonical_url_hash ~ '^[0-9a-f]{64}$'
  ),
  fingerprint text,
  status text NOT NULL DEFAULT 'active' CHECK (
    status IN ('active', 'expired', 'closed', 'duplicate', 'rejected')
  ),
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  confidence numeric(5, 4) NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  needs_review boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (last_seen_at >= first_seen_at),
  CHECK (
    needs_review
    OR (company IS NOT NULL AND role IS NOT NULL AND application_url IS NOT NULL)
  )
);

CREATE UNIQUE INDEX opportunities_canonical_url_hash_unique
  ON aggregator.opportunities (canonical_url_hash)
  WHERE canonical_url_hash IS NOT NULL;
CREATE INDEX opportunities_fingerprint_idx
  ON aggregator.opportunities (fingerprint)
  WHERE fingerprint IS NOT NULL;
CREATE INDEX opportunities_status_last_seen_idx
  ON aggregator.opportunities (status, last_seen_at DESC);

CREATE TRIGGER opportunities_set_updated_at
BEFORE UPDATE ON aggregator.opportunities
FOR EACH ROW EXECUTE FUNCTION aggregator.set_updated_at();

CREATE TABLE aggregator.opportunity_sources (
  opportunity_id uuid NOT NULL
    REFERENCES aggregator.opportunities(id) ON DELETE CASCADE,
  raw_event_id uuid NOT NULL UNIQUE
    REFERENCES aggregator.raw_events(id) ON DELETE RESTRICT,
  source_url text,
  observed_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (opportunity_id, raw_event_id)
);

CREATE INDEX opportunity_sources_raw_event_idx
  ON aggregator.opportunity_sources (raw_event_id);

CREATE TABLE aggregator.delivery_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  opportunity_id uuid NOT NULL
    REFERENCES aggregator.opportunities(id) ON DELETE CASCADE,
  destination_type text NOT NULL CHECK (
    destination_type IN ('discord_feed', 'discord_review', 'notion')
  ),
  destination_key text NOT NULL CHECK (length(btrim(destination_key)) > 0),
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  status text NOT NULL DEFAULT 'pending' CHECK (
    status IN ('pending', 'delivering', 'delivered', 'retry', 'dead')
  ),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  lease_expires_at timestamptz,
  external_message_id text,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (opportunity_id, destination_type, destination_key),
  CHECK (
    (status = 'delivering' AND lease_expires_at IS NOT NULL)
    OR status <> 'delivering'
  ),
  CHECK (
    (status = 'delivered' AND external_message_id IS NOT NULL)
    OR status <> 'delivered'
  )
);

CREATE INDEX delivery_outbox_claim_idx
  ON aggregator.delivery_outbox (next_attempt_at, created_at)
  WHERE status IN ('pending', 'retry');
CREATE INDEX delivery_outbox_expired_lease_idx
  ON aggregator.delivery_outbox (lease_expires_at)
  WHERE status = 'delivering';

CREATE TRIGGER delivery_outbox_set_updated_at
BEFORE UPDATE ON aggregator.delivery_outbox
FOR EACH ROW EXECUTE FUNCTION aggregator.set_updated_at();

CREATE TABLE aggregator.processing_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  raw_event_id uuid NOT NULL
    REFERENCES aggregator.raw_events(id) ON DELETE CASCADE,
  opportunity_id uuid
    REFERENCES aggregator.opportunities(id) ON DELETE SET NULL,
  status text NOT NULL CHECK (status IN ('started', 'succeeded', 'failed', 'review')),
  deterministic_parser_version text,
  model_provider text,
  model_name text,
  prompt_version text,
  input_tokens integer CHECK (input_tokens IS NULL OR input_tokens >= 0),
  output_tokens integer CHECK (output_tokens IS NULL OR output_tokens >= 0),
  cost_usd numeric(12, 8) CHECK (cost_usd IS NULL OR cost_usd >= 0),
  classification jsonb,
  validation_outcome jsonb,
  error_category text,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (completed_at IS NULL OR completed_at >= started_at)
);

CREATE INDEX processing_runs_raw_event_started_idx
  ON aggregator.processing_runs (raw_event_id, started_at DESC);

CREATE TABLE aggregator.webhook_nonces (
  caller_id text NOT NULL CHECK (length(btrim(caller_id)) > 0),
  nonce text NOT NULL CHECK (length(btrim(nonce)) >= 16),
  received_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (caller_id, nonce),
  CHECK (expires_at > received_at)
);

CREATE INDEX webhook_nonces_expiry_idx
  ON aggregator.webhook_nonces (expires_at);

GRANT USAGE ON SCHEMA aggregator TO aggregator_app, aggregator_readonly;
GRANT SELECT, INSERT, UPDATE, DELETE
  ON ALL TABLES IN SCHEMA aggregator TO aggregator_app;
GRANT SELECT
  ON ALL TABLES IN SCHEMA aggregator TO aggregator_readonly;
ALTER DEFAULT PRIVILEGES IN SCHEMA aggregator
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO aggregator_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA aggregator
  GRANT SELECT ON TABLES TO aggregator_readonly;

ALTER TABLE aggregator.opportunities
  DROP CONSTRAINT IF EXISTS opportunities_status_check;

ALTER TABLE aggregator.opportunities
  ADD CONSTRAINT opportunities_status_check
  CHECK (
    status IN (
      'active',
      'expired',
      'closed',
      'duplicate',
      'rejected',
      'possibly_removed'
    )
  );

CREATE TABLE aggregator.source_observations (
  source_config_id uuid NOT NULL
    REFERENCES aggregator.source_configs(id) ON DELETE CASCADE,
  observation_key text NOT NULL CHECK (length(btrim(observation_key)) > 0),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  consecutive_misses integer NOT NULL DEFAULT 0 CHECK (consecutive_misses >= 0),
  opportunity_id uuid
    REFERENCES aggregator.opportunities(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (source_config_id, observation_key)
);

CREATE INDEX source_observations_misses_idx
  ON aggregator.source_observations (source_config_id, consecutive_misses)
  WHERE consecutive_misses > 0;

CREATE TRIGGER source_observations_set_updated_at
BEFORE UPDATE ON aggregator.source_observations
FOR EACH ROW EXECUTE FUNCTION aggregator.set_updated_at();

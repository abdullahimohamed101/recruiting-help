DROP TRIGGER IF EXISTS source_observations_set_updated_at
  ON aggregator.source_observations;
DROP TABLE IF EXISTS aggregator.source_observations;

UPDATE aggregator.opportunities
SET status = 'closed'
WHERE status = 'possibly_removed';

ALTER TABLE aggregator.opportunities
  DROP CONSTRAINT IF EXISTS opportunities_status_check;

ALTER TABLE aggregator.opportunities
  ADD CONSTRAINT opportunities_status_check
  CHECK (
    status IN ('active', 'expired', 'closed', 'duplicate', 'rejected')
  );

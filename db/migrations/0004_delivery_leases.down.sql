UPDATE aggregator.delivery_outbox
SET
  status = 'retry',
  lease_expires_at = NULL,
  next_attempt_at = now(),
  last_error = COALESCE(last_error, 'Delivery lease cleared during rollback of migration 0004.')
WHERE status = 'delivering';

ALTER TABLE aggregator.delivery_outbox
  DROP CONSTRAINT IF EXISTS delivery_outbox_lease_token_check,
  DROP COLUMN IF EXISTS lease_token;

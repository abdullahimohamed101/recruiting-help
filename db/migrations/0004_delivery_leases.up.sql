ALTER TABLE aggregator.delivery_outbox
  ADD COLUMN lease_token uuid;

ALTER TABLE aggregator.delivery_outbox
  ADD CONSTRAINT delivery_outbox_lease_token_check CHECK (
    (status = 'delivering' AND lease_token IS NOT NULL)
    OR status <> 'delivering'
  );

UPDATE aggregator.delivery_outbox
SET
  status = 'retry',
  lease_expires_at = NULL,
  lease_token = NULL,
  next_attempt_at = now(),
  last_error = 'Delivery lease reset during migration 0004.'
WHERE status = 'delivering';

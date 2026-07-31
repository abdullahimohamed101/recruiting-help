ALTER TABLE aggregator.opportunities
  DROP CONSTRAINT IF EXISTS opportunities_employment_type_check;

ALTER TABLE aggregator.opportunities
  ADD CONSTRAINT opportunities_employment_type_check CHECK (
    employment_type IS NULL
    OR employment_type IN ('internship', 'co_op', 'new_grad')
  );

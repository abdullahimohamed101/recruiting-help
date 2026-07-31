# Processing

Orchestrates Phase 4 raw-event processing:

1. Claim a leased raw event
2. Extract and validate an opportunity candidate
3. Deduplicate exactly or route fuzzy matches to review
4. Persist opportunity, source link, and outbox delivery atomically

See [Processing core](../../docs/processing.md).

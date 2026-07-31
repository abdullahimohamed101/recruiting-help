# Processing core

Phase 4 transforms accepted raw events into validated opportunities and queues at most one Discord-feed outbox delivery per new active opportunity.

## Path

```text
WF-03 schedule (every minute)
  -> POST http://processor:3001/v1/process-batch
    -> claim leased raw_events row
    -> deterministic extraction, else relevance filter + optional AI
    -> evidence validation and scope checks
    -> exact dedupe or fuzzy-review routing
    -> atomic opportunity + source + outbox + raw status update
```

The processor service is private to the Docker network. Use the CLI for local one-off runs:

```bash
corepack pnpm process:events -- --limit 10
```

## Terminal dispositions

Every claimed raw event ends in one of:

| Disposition | Meaning                                                                                                |
| ----------- | ------------------------------------------------------------------------------------------------------ |
| `processed` | Opportunity linked; outbox enqueued only for new active opportunities                                  |
| `ignored`   | Noise or outside product scope                                                                         |
| `review`    | Needs human review (missing fields, low confidence, fuzzy duplicate, invalid evidence, AI unavailable) |
| `failed`    | Retriable processing exception with backoff                                                            |

Closed opportunities (`🔒`) are stored with status `closed` and do not enqueue delivery.

## Extraction policy

- Deterministic parsers run first (GitHub markdown rows and labeled text).
- Irrelevant noise is ignored before any model call.
- AI fallback is provider-neutral; automated tests use fakes.
- Every non-null field requires source evidence.
- Application URLs must appear literally in the source payload (or come from the trusted redirect resolver).
- Prompt/model/parser versions and estimated cost are recorded on `processing_runs`.

## Deduplication hierarchy

1. Source event identity (`source_type`, `source_account`, `source_event_id`)
2. Canonical application URL hash
3. Stable job-board identity
4. Conservative fingerprint
5. Fuzzy similarity → review only, never auto-suppress

## Local verification

```bash
corepack pnpm db:migrate
corepack pnpm test
TEST_DATABASE_URL=postgresql://recruiting_help:local-development-only@127.0.0.1:5432/recruiting_help_test \
  corepack pnpm test:integration
```

Optional AI fallback:

```bash
export GEMINI_API_KEY=...
corepack pnpm process:dev
```

Approve confidence thresholds and extraction prompts before enabling AI in shared environments. Default auto-publish confidence is `0.85`.

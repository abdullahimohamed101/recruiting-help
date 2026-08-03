# Database and contracts

Phase 2 defines the stable event/opportunity interfaces and PostgreSQL durability boundary. Phase 4 extends the schema for processing leases, stable job IDs, and review audit fields.

## Contracts

`packages/contracts` exports strict Zod schemas and inferred TypeScript types for:

- versioned raw events
- source-specific metadata
- attachments
- opportunity candidates
- source, processing, delivery, opportunity, and connector-health states

Source metadata is a discriminated union. A GitHub event cannot carry Discord metadata, and strict objects reject unexpected fields such as credentials.

Unknown extracted opportunity values remain `null`. They are not inferred or replaced with placeholder strings.

## Schema

Migration `0001_initial_schema` creates the `aggregator` schema. Migration `0002_processing_core` adds processing leases, stable job-board identity, normalized fuzzy-match helpers, and processing-run review fields. Migration `0003_expand_employment_types` allows `new_grad` alongside `internship` and `co_op`. Migration `0004_delivery_leases` adds delivery outbox lease tokens for Discord publishing. Migration `0005_github_observations` adds `possibly_removed` opportunity status and per-source observation tracking for two-poll closure.

| Table                 | Responsibility                                               |
| --------------------- | ------------------------------------------------------------ |
| `source_configs`      | Non-secret connector configuration                           |
| `source_cursors`      | ETags and source checkpoints                                 |
| `connector_health`    | Current adapter state and safe diagnostics                   |
| `source_observations` | Per-source seen keys for removal / closure                   |
| `raw_events`          | Immutable source-event payload boundary and processing state |
| `opportunities`       | Canonical normalized opportunities                           |
| `opportunity_sources` | Many-source evidence links                                   |
| `delivery_outbox`     | Idempotent destination delivery queue                        |
| `processing_runs`     | Parser/model and validation audit records                    |
| `webhook_nonces`      | Signed-intake replay protection                              |

The migration also creates NOLOGIN group roles:

- `aggregator_app`: CRUD access to aggregator tables
- `aggregator_readonly`: SELECT access only

Production login roles will be granted membership without receiving database-owner or superuser access.

## Idempotency boundaries

Raw source events are unique by:

```text
(source_type, source_account, source_event_id)
```

Deliveries are unique by:

```text
(opportunity_id, destination_type, destination_key)
```

Canonical URL hashes have a partial unique index when non-null. Fingerprints are indexed but not unique because fuzzy matches require review.

Repository helpers use parameterized SQL. Duplicate raw-event and outbox inserts return the existing row plus `inserted: false`.

## Migrations

Apply all forward migrations:

```bash
DATABASE_URL=postgresql://... corepack pnpm db:migrate
```

Migrations:

- run under a PostgreSQL advisory lock
- run one file per transaction
- record successful versions in `public.aggregator_schema_migrations`
- are safe to invoke repeatedly

### Rollback policy

Production rollback is forward-fix only. Do not run destructive down migrations in production.

Development/test rollback requires both a non-production `NODE_ENV` and explicit confirmation:

```bash
NODE_ENV=development \
ALLOW_DESTRUCTIVE_ROLLBACK=true \
DATABASE_URL=postgresql://... \
corepack pnpm db:rollback:dev
```

Cluster-scoped NOLOGIN roles are deliberately retained during database rollback.

## Integration tests

Tests refuse destructive work unless the database name ends in `_test`.

With the local Postgres service running:

```bash
docker compose -f infra/compose.dev.yaml up -d --wait postgres
docker compose -f infra/compose.dev.yaml exec -T postgres \
  createdb -U recruiting_help recruiting_help_test

NODE_ENV=test \
TEST_DATABASE_URL=postgresql://recruiting_help:local-development-only@127.0.0.1:5432/recruiting_help_test \
corepack pnpm test:integration
```

The suite verifies:

- clean migration and complete recreation
- migration idempotency
- concurrent source-event idempotency
- concurrent outbox idempotency
- invalid status rejection
- hostile strings remain data
- least-privilege grants

CI runs these tests against a real PostgreSQL 17 service.

## Retention

Approved baseline:

- raw source payloads: 90 days
- processing audit records: 90 days
- canonical opportunities: indefinite
- webhook nonces: 10 minutes
- diagnostic screenshots: failures only, local VPS storage, 7 days

Phase 2 provides timestamp/index support. Automated pruning is added with the reconciliation and operations phase.

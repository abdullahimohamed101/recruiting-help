# Internship Aggregator — Project Phases and Execution Plan

**Status:** Implementation in progress; VPS-first production deployment  
**Companion design:** [Internship Opportunity Aggregator — Detailed Design](internship-opportunity-aggregator-design.md)

### Execution status

| Phase                                     | Status                          | Completed      |
| ----------------------------------------- | ------------------------------- | -------------- |
| Phase 0 — decisions and prerequisites     | Complete                        | July 29, 2026  |
| Phase 1 — repository and local foundation | Complete; pending review/commit | July 29, 2026  |
| Phase 2 — contracts and database          | Complete; pending review/commit | July 30, 2026  |
| Phase 3 — unified signed ingestion        | Complete; pending review/commit | July 30, 2026  |
| Phase 4 — processing core                 | Complete; pending review/commit | July 30, 2026  |
| Phase 5 — Discord destination and intake  | Coding complete; operator smoke | August 3, 2026 |

## 1. How to use this plan

Build one phase at a time. Do not ask an AI agent to implement the entire system in one pass. Each phase should end with:

1. Working code or configuration.
2. Automated tests.
3. A short manual verification.
4. Updated documentation.
5. A clean Git commit created only after review.

For each phase:

- Give the coding agent the phase objective, relevant design sections, constraints, and acceptance criteria.
- Let it inspect the current repository before proposing changes.
- Ask it to implement and test only that phase.
- Review the diff and run the manual checks listed under **Your work**.
- Do not paste credentials, cookies, tokens, passwords, recovery codes, or browser profiles into chat or source files.

## 2. Responsibility model

### Work you must do

These actions require your identity, external accounts, consent, or judgment and cannot be completed autonomously by a coding agent:

- Create and verify Discord, Instagram, Slack, GitHub, VPS-provider, backup-storage, Tailscale, and model-provider accounts.
- Accept platform terms and the alternate-account collection risks described in the design.
- Join target Discord servers, Slack workspaces, and follow target Instagram accounts.
- Complete logins, MFA, CAPTCHA, SSO, account challenges, and recovery.
- Install or authorize apps where a platform asks for your approval.
- Create or select Discord servers/channels and decide who can access them.
- Enter production secrets directly into n8n on the VPS or root-readable VPS secret files; enter test-only secrets into ignored local files.
- Decide exact sources, opportunity filters, data retention, and monthly budget.
- Verify live scraped output against what you can see in each platform.
- Decide whether collecting or redistributing content is acceptable for your use.
- Approve cloud costs and production deployment.
- Complete VPS identity/payment verification and select the billing region.
- Use the private headed-browser session for production Discord, Instagram, and Slack authentication.

### Work the coding agent can do

I can perform most repository and implementation work:

- Create the monorepo, packages, services, configuration, and documentation.
- Implement Postgres migrations and database access.
- Implement contracts, validation, HMAC signing, and idempotency.
- Implement the Discord bot and output publisher.
- Implement GitHub polling and repository-specific parsers.
- Implement Playwright adapters for Discord, Instagram, and Slack.
- Implement OCR/vision integration behind provider-neutral interfaces.
- Build n8n workflow JSON, setup instructions, and import/export scripts.
- Implement extraction, normalization, deduplication, outbox delivery, retries, and reconciliation.
- Add unit, fixture, contract, integration, and failure-injection tests.
- Add Docker Compose, CI, linting, formatting, logging, metrics, and runbooks.
- Diagnose failures using sanitized logs, screenshots, fixtures, and test output.

### Shared work

Some tasks require both:

| Task                     | Your part                                   | Coding-agent part                                            |
| ------------------------ | ------------------------------------------- | ------------------------------------------------------------ |
| Browser login            | Complete login/MFA manually                 | Build persistent-profile launcher and health detection       |
| Source adapter           | Identify target and confirm visible content | Implement extraction/checkpoint logic                        |
| Discord bot installation | Create app and authorize it                 | Implement bot and calculate minimum permissions              |
| n8n credentials          | Enter secrets in UI                         | Build workflows and document credential names                |
| Production release       | Approve provider/cost and supply secrets    | Prepare deployment and validate health                       |
| VPS provisioning         | Create/pay for server and approve access    | Harden host, install runtime, deploy Compose, and verify it  |
| Private administration   | Join your devices to Tailscale              | Configure services to bind privately and document access     |
| Production backup        | Create/approve backup destination           | Implement encryption, upload, retention, and restore tooling |
| Parser validation        | Compare output with source                  | Fix parser and add regression fixtures                       |
| AI extraction            | Choose provider/budget                      | Implement schema, prompt, validation, and cost tracking      |

## 3. Recommended implementation defaults

These defaults make the project straightforward to vibe-code. Change them during Phase 0 if needed.

| Area                     | Default                                                       |
| ------------------------ | ------------------------------------------------------------- |
| Language                 | TypeScript                                                    |
| Runtime                  | Current Node.js LTS at implementation time                    |
| Package manager          | pnpm workspaces                                               |
| Database                 | PostgreSQL                                                    |
| Query layer              | Thin typed repository layer using parameterized SQL           |
| Validation               | Zod or equivalent runtime schemas                             |
| Browser automation       | Playwright                                                    |
| Bot library              | discord.js                                                    |
| Tests                    | Vitest plus Playwright fixture tests                          |
| Local orchestration      | Docker Compose                                                |
| Production orchestration | Docker Compose on one Ubuntu x86 VPS                          |
| Production VPS           | 2 shared vCPU, 4 GB RAM, 40+ GB SSD, 2 GB swap                |
| Production access        | Tailscale; no public n8n or Postgres ports                    |
| Production database      | PostgreSQL on the VPS                                         |
| Browser administration   | On-demand headed Playwright/noVNC over Tailscale              |
| Backup                   | Nightly encrypted Postgres dump to independent object storage |
| Production budget        | $7–$15/month total                                            |
| Workflow engine          | n8n                                                           |
| Formatting/linting       | Prettier and ESLint                                           |
| CI                       | GitHub Actions                                                |
| Logging                  | Structured JSON with redaction                                |
| IDs                      | UUIDv7 when supported; otherwise UUIDv4                       |

Suggested repository structure:

```text
recruiting-help/
├── apps/
│   ├── intake-api/             # Private signed-event verifier and persistence boundary
│   ├── collector/              # Discord, Slack, Instagram browser adapters
│   └── discord-bot/            # Owned-server intake and interactions
├── packages/
│   ├── contracts/              # Raw event and opportunity schemas
│   ├── database/               # Migrations and repositories
│   ├── ingestion/              # HMAC protocol, limits, and allow-listing
│   ├── extraction/             # Deterministic and AI extraction
│   ├── observability/          # Logging, metrics, redaction
│   └── test-fixtures/
├── n8n/
│   ├── workflows/              # Version-controlled workflow exports
│   └── README.md
├── db/
│   └── migrations/
├── infra/
│   ├── compose.dev.yaml
│   ├── compose.prod.yaml
│   ├── tailscale/
│   ├── backup/
│   └── env.example
├── docs/
└── scripts/
```

### Execution boundary

The Mac is a development and administration client, not a server.

| Workload                                   | Before Phase 7                   | After Phase 7                      |
| ------------------------------------------ | -------------------------------- | ---------------------------------- |
| Unit and fixture tests                     | Mac or CI                        | Mac or CI                          |
| Short integration tests                    | Local development Compose        | Local or isolated VPS test command |
| n8n development                            | Temporary local container        | Production instance on VPS         |
| Production Postgres                        | Not active                       | VPS                                |
| Discord bot                                | Temporary local test process     | VPS                                |
| GitHub continuous polling                  | Controlled test runs             | VPS                                |
| Discord/Instagram/Slack browser collection | Fixture tests only               | VPS                                |
| OCR/AI production processing               | Test doubles or controlled calls | VPS                                |
| Browser re-authentication                  | Mac opens private UI             | Browser and profile remain on VPS  |

Do not run multi-day shadow validation on the Mac. Provision the VPS in Phase 7, then run every continuous validation and production workload there.

## 4. Phase overview

| Phase                                      | Outcome                                      | Depends on  |
| ------------------------------------------ | -------------------------------------------- | ----------- |
| 0. Product and source decisions            | Scope and external prerequisites are fixed   | None        |
| 1. Repository foundation                   | Reproducible local development environment   | Phase 0     |
| 2. Database and contracts                  | Durable schema and validated event contracts | Phase 1     |
| 3. Unified ingestion                       | Signed, idempotent raw-event persistence     | Phase 2     |
| 4. Processing core                         | Extraction, validation, dedupe, and outbox   | Phase 3     |
| 5. Discord destination and fallback intake | End-to-end vertical slice                    | Phase 4     |
| 6. GitHub connector                        | First fully automated production input       | Phase 5     |
| 7. VPS foundation                          | Always-on private production runtime         | Phase 6     |
| 8. Discord browser connector               | Automated restricted Discord input on VPS    | Phase 7     |
| 9. Instagram browser connector             | Posts, reels, stories, OCR/vision on VPS     | Phase 8     |
| 10. Slack connector                        | Official API or browser fallback on VPS      | Phase 8     |
| 11. Reliability and operations             | Recovery, alerts, backups, runbooks          | Phases 6–10 |
| 12. Production activation                  | Continuously running validated system        | Phase 11    |
| 13. Notion tracking                        | Optional application-management projection   | Phase 12    |

Do not begin all connectors in parallel. Complete the vertical slice and GitHub first so browser-connector bugs are isolated from core-pipeline bugs.

## 5. Phase 0 — product decisions and external prerequisites

### Objective

Resolve decisions that materially affect implementation. No application code is required.

### Your work

- [ ] Choose the initial opportunity scope:
  - internships only
  - internships and co-ops
  - internships, co-ops, and new-grad roles
- [ ] Define filters:
  - target graduation years
  - countries/regions
  - remote/hybrid/on-site preferences
  - sponsorship requirements
  - seasons and years
- [ ] List the first:
  - GitHub repository and target file
  - Discord server/channel
  - Instagram account
  - Slack workspace/channel
- [ ] Create the operator-owned Discord server.
- [ ] Create channels:
  - `#opportunity-intake`
  - `#internship-feed`
  - `#aggregator-review`
  - `#aggregator-ops`
- [ ] Create dedicated alternate Discord and Instagram accounts.
- [ ] Join/follow the target communities with those accounts.
- [ ] Confirm Slack app installation policy by attempting a normal app installation or checking the workspace UI.
- [ ] Choose a low-cost x86 VPS provider, plan, and region:
  - 2 shared vCPU
  - 4 GB RAM
  - at least 40 GB SSD
  - stable IPv4 preferred
  - expected cost of $7–$12/month
- [ ] Prefer a region reasonably close to your normal login geography.
- [ ] Create a free Tailscale account for private administration.
- [ ] Choose independent backup storage with a $0–$1/month target.
- [ ] Accept the total production budget guardrail of $7–$15/month.
- [ ] Choose a model provider and monthly AI budget.
- [ ] Choose raw-data and screenshot retention periods.

### Coding-agent work

- [ ] Convert your answers into `docs/product-requirements.md`.
- [ ] Create `config/sources.example.yaml` with no secrets.
- [ ] Create `config/filters.example.yaml`.
- [ ] Record architecture decision records for any changed defaults.
- [ ] Update design-doc open decisions.

### Deliverables

- Product requirements.
- Initial source inventory.
- Filter specification.
- Risk acceptance and retention decisions.
- Selected VPS plan/region, backup destination, and monthly budget cap.

### Exit criteria

- Every open decision needed for Phases 1–6 has an answer.
- The first GitHub source and owned Discord destination are known.
- VPS requirements and budget are fixed, even though provisioning occurs in Phase 7.
- No secrets are committed.

### Suggested vibe-coding prompt

> Read the design and project-phases documents. Ask me only for unresolved Phase 0 product decisions, then create product requirements, source/filter example configuration, and ADRs. Do not implement application code or include secrets.

## 6. Phase 1 — repository and local-development foundation

### Objective

Create a reproducible TypeScript monorepo that contributors and coding agents can safely modify. Local services are short-lived development dependencies; they are not the continuous production runtime.

### Your work

- [ ] Confirm the proposed stack and repository structure.
- [ ] Install Docker Desktop or another compatible container runtime.
- [ ] Confirm Docker can run locally.
- [ ] Review generated scripts before running them.

### Coding-agent work

- [ ] Initialize pnpm workspace configuration.
- [ ] Create the apps/packages directory structure.
- [ ] Add TypeScript base configuration.
- [ ] Configure linting, formatting, and tests.
- [ ] Add environment validation and `.env.example`.
- [ ] Extend `.gitignore` for secrets, browser profiles, screenshots, traces, and local volumes.
- [ ] Create `compose.dev.yaml` for short-lived local Postgres and n8n.
- [ ] Create a production Compose skeleton with no real secrets.
- [ ] Add health checks for services.
- [ ] Add Makefile or package scripts for:
  - setup
  - development
  - test
  - lint
  - typecheck
  - database migration
  - workflow import/export
- [ ] Add GitHub Actions for lint, typecheck, and unit tests.
- [ ] Document local setup.
- [ ] Document the boundary: Mac for development/tests, VPS for all continuous runtime.

### Required tests

- Fresh clone/install succeeds.
- Typecheck, lint, and empty test suite pass.
- Postgres and n8n become healthy through Compose.
- Development Compose can be stopped without affecting any deployed production state.
- Missing environment variables produce clear errors.

### Exit criteria

- One command starts local dependencies.
- One command runs all static checks and tests.
- CI passes without credentials.
- No service-specific business logic has been added.

### Suggested vibe-coding prompt

> Implement Phase 1 only. Use the defaults in the project phases document. Create a pnpm TypeScript monorepo, short-lived local Postgres/n8n development Compose stack, production Compose skeleton, quality tooling, CI, environment validation, and setup documentation. Make the Mac-versus-VPS boundary explicit. Run all checks. Do not implement connectors.

## 7. Phase 2 — database schema and shared contracts

### Objective

Implement the durable state and stable interfaces described in design sections 7 and 8.

### Your work

- [x] Review the fields retained from restricted communities.
- [x] Confirm retention periods: raw payloads for 90 days.
- [x] Retain failure-only diagnostic screenshots locally for 7 days.

### Coding-agent work

- [x] Implement versioned raw-event and opportunity schemas.
- [x] Implement source-specific metadata as typed discriminated unions.
- [x] Create migrations for:
  - `source_configs`
  - `source_cursors`
  - `connector_health`
  - `raw_events`
  - `opportunities`
  - `opportunity_sources`
  - `delivery_outbox`
  - `processing_runs`
  - webhook nonce/replay protection
- [x] Add unique constraints and indexes from the design.
- [x] Add database roles and least-privilege grants for local development.
- [x] Implement parameterized repository functions.
- [x] Add migration rollback policy; destructive production rollback is not assumed.
- [x] Add test factories and database cleanup helpers.

### Required tests

- Migrations apply to an empty database.
- Schema can be recreated from scratch.
- Duplicate source events fail or return the existing row predictably.
- Duplicate outbox entries cannot be created.
- Invalid status values are rejected.
- Repository functions do not interpolate SQL.
- Concurrent insert tests prove idempotency constraints.

### Exit criteria

- The database represents every state in the design.
- Contracts are shared by all future services.
- Database integration tests pass against real Postgres.

### Suggested vibe-coding prompt

> Implement Phase 2 from the project plan and design sections 7–8. Add typed contracts, Postgres migrations, repository functions, constraints, indexes, and integration tests. Use real Postgres in tests. Do not add n8n workflows or connectors.

## 8. Phase 3 — unified signed ingestion

### Objective

Accept events from trusted project services and persist them exactly once at the source-event boundary.

### Your work

- [x] Use the documented local-only HMAC fixture for isolated smoke testing; generate a fresh secret before any shared deployment.
- [x] Keep HMAC credentials in the private intake API environment; n8n contains no signing secret.
- [x] Import and publish the generated n8n workflow locally.
- [x] Trigger new, duplicate, and invalid-signature test events from the terminal.

### Coding-agent work

- [x] Create a shared HMAC client:
  - timestamp
  - nonce
  - raw-body signature
  - caller ID
- [x] Implement constant-time signature verification.
- [x] Enforce five-minute timestamp tolerance.
- [x] Store and reject reused nonces.
- [x] Allow-list caller/source combinations.
- [x] Enforce request and attachment-metadata size limits.
- [x] Build WF-02 Unified Intake as version-controlled n8n JSON.
- [x] Persist raw events and return:
  - accepted
  - duplicate
  - validation error
  - unauthorized
- [x] Add a command-line event sender for local testing.
- [x] Redact signatures and payload-sensitive fields from logs.

### Required tests

- Valid event is inserted.
- Identical retry returns duplicate success.
- Invalid signature, stale timestamp, reused nonce, oversized body, and unauthorized source are rejected.
- Database failure does not return success.
- Signature verification uses the exact raw request bytes.

### Exit criteria

- Any future connector can submit the canonical raw-event envelope.
- Retries are safe.
- No platform credentials enter n8n event payloads.

### Suggested vibe-coding prompt

> Implement Phase 3 only. Build the shared signed-ingestion client, replay protection, source allow-listing, CLI sender, and importable n8n workflow. Add adversarial contract tests and run them. Never generate or commit real secrets.

## 9. Phase 4 — processing, extraction, deduplication, and outbox

### Objective

Transform raw events into validated opportunities and queue exactly one destination delivery.

### Your work

- [ ] Enter your selected model API key into n8n or the chosen secret store.
- [ ] Approve the initial extraction prompt and confidence thresholds.
- [ ] Provide 20–50 representative opportunity/noise samples with private information removed.
- [ ] Review false positives and false negatives.

### Coding-agent work

- [x] Implement URL extraction and canonicalization.
- [x] Implement tracking-parameter removal.
- [x] Implement safe redirect resolution with SSRF protections.
- [x] Implement deterministic company/role/job-board parsers.
- [x] Implement cheap relevance filtering.
- [x] Implement provider-neutral structured AI extraction.
- [x] Require evidence for extracted fields.
- [x] Reject hallucinated URLs not found in source evidence.
- [x] Implement exact URL and stable job-ID dedupe.
- [x] Implement conservative fingerprints.
- [x] Route fuzzy matches to review instead of suppressing them.
- [x] Implement leasing and processing attempts.
- [x] Implement the atomic opportunity/source/outbox transaction.
- [x] Build WF-03 processing workflow.
- [x] Record prompt/model/parser versions and estimated cost.

### Required tests

- Prompt-injection samples cannot alter processing behavior.
- Missing fields stay null.
- Same application URL across source types maps to one opportunity.
- Distinct roles at one company are not merged.
- Crash/retry after extraction remains idempotent.
- Transaction failure leaves no partial opportunity/outbox state.
- Low-confidence and fuzzy-duplicate items enter review.

### Exit criteria

- A raw event reaches one terminal state: processed, ignored, review, or failed.
- Every accepted new opportunity has one pending outbox row.
- No AI-generated URL is published without source evidence.

### Suggested vibe-coding prompt

> Implement Phase 4 using design sections 7–10. Build deterministic-first extraction, provider-neutral AI fallback, strict evidence validation, conservative dedupe, leases, and the atomic outbox transaction. Add adversarial and concurrency tests. Use fake model responses in automated tests.

## 10. Phase 5 — Discord destination and manual fallback intake

### Objective

Complete the first end-to-end vertical slice before adding automated source connectors.

### Your work

- [ ] Create a Discord application and bot in the Developer Portal.
- [ ] Enable only the documented intents.
- [ ] Copy the bot token into your local environment/secret manager.
- [ ] Install the bot into your owned server using the generated least-privilege URL.
- [ ] Assign access only to the four project channels.
- [ ] Verify test posts in a non-production channel first.

### Coding-agent work

- [x] Implement the discord.js bot.
- [x] Read fallback submissions from `#opportunity-intake`.
- [x] Parse native forwarded-message snapshots.
- [x] Send signed raw events to WF-02.
- [x] Add status reactions (`⏳` / `✅` / `♻️` / `🔁` / `❌`).
- [x] Implement WF-04 outbox delivery (feed + review destinations).
- [x] Render safe Discord embeds (lean feed + review).
- [x] Disable all mentions.
- [x] Respect Discord rate limits and `Retry-After`.
- [x] Store returned Discord message IDs.
- [x] Route review items via `discord_review` outbox (WF-05 folded into WF-04; no separate n8n workflow).
- [x] Implement WF-06 error alerts.
- [x] Add a bot health endpoint and graceful shutdown.
- [x] Exact opportunity duplicates react `🔁` on the intake message after processing.

### Required manual test

Run with Compose `--profile discord` and WF-02 / WF-03 / WF-04 / WF-06 published.

1. Paste a **new** job URL into `#opportunity-intake`.
2. Confirm `⏳`, then `✅` (not `🔁` yet).
3. Confirm **one** lean message in `#internship-feed` (type · location · work mode; Posted/About when known).
4. Paste the **same URL again** as a new message.
5. Confirm `✅`, then `🔁`, and **no** second feed post.
6. (Optional) Retry the exact same Discord message through intake → expect `♻️`.
7. Submit an incomplete item (no usable company/role/link).
8. Confirm it appears in `#aggregator-review`, not the feed.
9. Force a workflow failure (or use a known bad path) and confirm `#aggregator-ops` gets a sanitized alert with no secrets.

### Exit criteria

- [x] Coding: ingest → process → dedupe → outbox → Discord path implemented and covered by automated tests.
- [ ] Operator: required manual test above passes on your owned guild.
- Duplicate retries do not duplicate feed messages (`🔁` / `♻️` semantics).
- Errors appear in `#aggregator-ops` without secrets.

### Suggested vibe-coding prompt

> Implement Phase 5 only. Build the owned-server Discord bot, fallback intake, status reactions, outbox publisher, safe embeds, review workflow, and error notifications. Generate a least-privilege invite URL and a manual test checklist, but do not attempt to create or install the Discord application for me.

## 11. Phase 6 — GitHub connector

### Objective

Implement the first reliable automated source and validate it through fixtures and controlled runs. Continuous 48-hour shadow validation begins after the VPS foundation is available.

### Your work

- [ ] Confirm the repository, branch, and target file.
- [ ] Create a fine-grained read-only GitHub token if higher limits are needed.
- [ ] Use a test credential locally if required; production credentials wait for Phase 7.
- [ ] Compare controlled output with the source.

### Coding-agent work

- [ ] Build WF-01 conditional GitHub polling.
- [ ] Persist ETags/blob SHAs and source health.
- [ ] Implement the first repository-specific parser.
- [ ] Add real, versioned fixtures.
- [ ] Parse complete current snapshots.
- [ ] Advance cursors only after durable event insertion.
- [ ] Add polling jitter and rate-limit handling.
- [ ] Detect parser/schema drift.
- [ ] Implement two-observation removal/closure logic.
- [ ] Add shadow mode that stores but does not deliver.

### Required tests

- `200`, `304`, timeout, rate-limit, branch rename, reordered rows, edited rows, and removed rows.
- Cursor does not advance after persistence failure.
- Repository format change triggers an alert.

### Exit criteria

- Fixture and controlled-run precision is at least 95%.
- No fixture opportunities are missed.
- Shadow mode can be disabled without code changes.
- Continuous 48-hour validation is explicitly deferred to Phase 7.

### Suggested vibe-coding prompt

> Implement Phase 6 for this exact repository and file: [provide source]. Use conditional requests, complete-snapshot parsing, durable cursors, source-specific fixtures, shadow mode, and drift detection. Run contract and fixture tests.

## 12. Phase 7 — VPS foundation

### Objective

Create the private, always-on production runtime before beginning multi-day browser shadow tests. After this phase, the Mac may be shut down without interrupting deployed GitHub polling, n8n, Postgres, bot operation, backups, or health checks.

### Target infrastructure

- One x86-64 Ubuntu LTS VPS.
- 2 shared vCPU.
- 4 GB RAM.
- At least 40 GB SSD.
- 2 GB swap.
- Expected VPS cost: $7–$12/month.
- Expected total system cost: $7–$15/month.
- Tailscale-only administration.
- Docker Compose production stack.
- No public n8n or Postgres ports.

### Your work

- [ ] Create the selected VPS-provider account.
- [ ] Complete provider identity and payment verification.
- [ ] Create the approved x86 VPS in the selected region.
- [ ] Record the recurring price and configure a budget alert if available.
- [ ] Create/join the Tailscale network.
- [ ] Create the independent backup-storage account/bucket.
- [ ] Add the VPS SSH host key after verifying it through the provider console.
- [ ] Enter production secrets when prompted; never paste them into chat.
- [ ] Approve any deployment command that creates or modifies remote resources.

### Coding-agent work — host bootstrap

- [ ] Produce an idempotent bootstrap script or Ansible playbook.
- [ ] Apply operating-system updates.
- [ ] Create a non-root deployment user.
- [ ] Require SSH keys and disable password SSH.
- [ ] Install and join Tailscale with your authorization.
- [ ] Configure a default-deny firewall.
- [ ] Restrict SSH to Tailscale where practical.
- [ ] Install Docker Engine and Compose.
- [ ] Configure log rotation and time synchronization.
- [ ] Create 2 GB swap with conservative swappiness.
- [ ] Configure automatic security updates.
- [ ] Document provider-console recovery access.

### Coding-agent work — production Compose

- [ ] Finalize `compose.prod.yaml` for:
  - PostgreSQL
  - n8n Community Edition
  - Discord bot
  - collector/controller
  - backup job
- [ ] Pin images and application versions.
- [ ] Add `unless-stopped` restart policies.
- [ ] Add health checks.
- [ ] Add non-root execution where supported.
- [ ] Add resource limits and reservations.
- [ ] Create internal-only Docker networks.
- [ ] Ensure Postgres is not host-published.
- [ ] Bind n8n only to a private/loopback interface.
- [ ] Create named volumes:
  - `postgres_data`
  - `n8n_data`
  - `browser_profiles`
  - `temporary_diagnostics`
- [ ] Add safe deployment, migration, status, log, and rollback scripts.

### Coding-agent work — private administration

- [ ] Document accessing n8n through Tailscale.
- [ ] Implement an on-demand headed Playwright/noVNC administration profile.
- [ ] Bind noVNC only to the Tailscale/private interface.
- [ ] Require a temporary strong access credential.
- [ ] Provide explicit start, stop, and verification commands.
- [ ] Ensure noVNC is stopped outside authentication sessions.
- [ ] Confirm no domain or public reverse proxy is required.

### Coding-agent work — backup

- [ ] Implement nightly encrypted Postgres logical backups.
- [ ] Keep seven daily and four weekly backups.
- [ ] Upload to the independent backup destination.
- [ ] Store `N8N_ENCRYPTION_KEY` separately from database backups.
- [ ] Version-control n8n workflows, not credential values.
- [ ] Exclude browser profiles from backups.
- [ ] Add diagnostic-media cleanup.
- [ ] Add backup success/failure alerts.
- [ ] Create a restoration script and runbook.

### Resource verification

Measure while n8n, Postgres, bot, and one Chromium workload are active:

- total RAM and swap
- per-container memory
- CPU load
- disk utilization
- database size
- browser startup latency

Do not enable simultaneous Discord, Slack, and Instagram Chromium runs. Introduce a global browser lease before browser connectors are deployed.

### Deployment sequence

1. Bootstrap host and Tailscale.
2. Deploy Postgres and n8n.
3. Apply migrations.
4. Import version-controlled workflows.
5. Enter production credentials.
6. Deploy the bot in output-disabled mode.
7. Deploy the collector controller with all browser sources disabled.
8. Configure and test backup.
9. Run smoke tests.
10. Enable GitHub in shadow mode for 48 hours.

### Required tests

- Public scans cannot reach n8n or Postgres.
- Tailscale-connected Mac can access n8n.
- All containers recover after a VPS reboot.
- Persistent data survives Compose recreation.
- Invalid/missing production secrets fail startup clearly.
- A database backup can be decrypted and restored into a temporary database.
- Stopping the Mac does not affect the VPS.
- GitHub shadow polling continues for 48 hours.

### Exit criteria

- The complete non-browser stack runs continuously on the VPS.
- GitHub completes 48 hours of shadow validation with at least 95% precision.
- Monthly estimated cost remains within $7–$15.
- Backups and one restore test succeed.
- n8n and Postgres have no public exposure.
- The Mac is not an operational dependency.

### Suggested vibe-coding prompt

> Implement Phase 7 for the selected x86 Ubuntu VPS. Prepare idempotent host bootstrap, Tailscale-only administration, hardened Docker Compose production deployment, 2 GB swap, persistent volumes, resource limits, encrypted off-host Postgres backups, restore tooling, noVNC-on-demand browser administration, and GitHub shadow activation. Do not create paid resources or enter secrets for me. Stop for approval before every external write.

## 13. Phase 8 — Discord browser collector

### Objective

Automate one restricted Discord channel on the VPS using a dedicated alternate account and a replaceable browser adapter.

### Your work

- [ ] Connect the Mac to the VPS through Tailscale.
- [ ] Start the on-demand private headed-browser/noVNC session.
- [ ] Log into Discord manually in the VPS-hosted browser profile.
- [ ] Complete email/phone verification, MFA, CAPTCHA, or challenges yourself.
- [ ] Confirm the alternate account can view the target channel.
- [ ] Provide server/channel URLs through non-secret configuration.
- [ ] Stop noVNC after authentication.
- [ ] Compare collected IDs/messages with the channel daily during shadow mode.

### Coding-agent work

- [ ] Create the Playwright collector service and adapter interface.
- [ ] Create isolated persistent VPS contexts per platform.
- [ ] Store profiles only in the protected `browser_profiles` volume.
- [ ] Implement headed setup and headless collection commands.
- [ ] Integrate with the global browser lease and VPS memory limits.
- [ ] Implement page-state classification:
  - healthy
  - logged out
  - MFA/challenge
  - limited/rate-limited
  - selector broken
- [ ] Implement direct channel navigation and target verification.
- [ ] Extract rendered message snowflakes, timestamps, text, links, embeds, and attachment metadata.
- [ ] Handle virtualized message lists.
- [ ] Persist checkpoints only after n8n acknowledgement.
- [ ] Add a bounded backfill mode.
- [ ] Add daily recent-window reconciliation.
- [ ] Save redacted diagnostics on structural failure.
- [ ] Add shadow mode and connector-health reporting.

### What the coding agent will not do

- Log into the account for you.
- Solve CAPTCHA/MFA or bypass limited access.
- Extract or use a Discord user token.
- Automate account creation or ban evasion.

### Required tests

- DOM fixtures for all page states.
- Duplicate messages and edited messages.
- Partial virtualized history.
- Adapter termination before acknowledgement.
- Login expiry without checkpoint advancement.
- Selector removal resulting in `selector_broken`, not an empty healthy run.

### Exit criteria

- One channel completes 72 hours of shadow mode.
- Observed messages match the source during the validation window.
- Re-authentication and selector failures are explicit.
- Feed delivery can be enabled through configuration.
- The collector continues while the Mac is shut down.
- Production re-authentication is possible privately without exposing noVNC publicly.

### Suggested vibe-coding prompt

> Implement Phase 8 for one configured Discord channel on the VPS. Use Playwright with a persistent VPS profile and DOM-only collection—no user-token API. Integrate the global browser lease, memory limits, Tailscale-only noVNC login, page-state classification, snowflake checkpoints, bounded backfill, reconciliation, redacted diagnostics, fixtures, and shadow mode. Stop at manual login and tell me exactly what private command and URL to use.

## 14. Phase 9 — Instagram browser collector

### Objective

Collect posts, reels, and stories on the VPS from configured third-party accounts using the dedicated alternate account.

### Your work

- [ ] Connect through Tailscale and start the private on-demand headed browser.
- [ ] Log into Instagram manually in the VPS-hosted browser profile.
- [ ] Complete all account challenges yourself.
- [ ] Confirm the alternate account follows/can view targets.
- [ ] Provide profile URLs and content types to watch.
- [ ] Review story screenshots/OCR during shadow mode.
- [ ] Approve temporary-media retention and vision budget.
- [ ] Stop noVNC after authentication.

### Coding-agent work

- [ ] Implement Instagram adapter and target verification.
- [ ] Integrate the adapter with the global browser lease and resource budget.
- [ ] Detect unseen posts, reels, and stories.
- [ ] Extract stable IDs, timestamps, visible captions, and links.
- [ ] Capture temporary screenshots for image-only stories.
- [ ] Add local OCR.
- [ ] Add vision fallback behind confidence and budget gates.
- [ ] Delete temporary media after extraction unless review retention applies.
- [ ] Track story coverage windows and known gaps.
- [ ] Detect login/challenge/rate-limit/selector states.
- [ ] Add profile fixtures and OCR fixtures.
- [ ] Add shadow mode and health alerts.

### Required tests

- Post/reel/story IDs dedupe correctly.
- Multiple story frames are ordered and associated correctly.
- OCR failure routes to vision or review.
- Temporary media is deleted according to policy.
- An outage past story expiry records a coverage gap.
- Login challenge does not advance checkpoints.

### Exit criteria

- One-week shadow-mode report includes precision, story coverage, failures, and model cost.
- Low-confidence media goes to review.
- No browser-profile or cookie data enters logs or n8n.
- Collection and OCR continue with the Mac shut down.

### Suggested vibe-coding prompt

> Implement Phase 9 on the VPS using the existing collector adapter interface. Add Instagram posts/reels/stories, global browser leasing, stable checkpoints, screenshots, VPS-local OCR, budget-gated vision fallback, temporary-media cleanup, coverage-gap metrics, fixtures, and shadow mode. Use the Tailscale-only noVNC login path and stop for my manual authentication.

## 15. Phase 10 — Slack connector

### Objective

Use the most reliable Slack route the workspace permits.

### Your work

- [ ] Attempt to create/install a minimal Slack app.
- [ ] If allowed, authorize only required channel-read/history scopes.
- [ ] Enter OAuth credentials into n8n.
- [ ] If blocked, decide whether to use browser collection with your existing account.
- [ ] Complete SSO/MFA manually through the VPS's private headed-browser session.
- [ ] Confirm target channel and thread behavior.

### Coding-agent work — official API path

- [ ] Implement WF-09 Slack polling.
- [ ] Use channel timestamps/cursors.
- [ ] Honor current rate limits and pagination.
- [ ] Read only configured channels.
- [ ] Fetch threads only after root relevance filtering.
- [ ] Refresh/re-authorize tokens through supported OAuth behavior.

### Coding-agent work — browser fallback

- [ ] Implement Slack Playwright adapter.
- [ ] Integrate it with the VPS global browser lease and resource budget.
- [ ] Detect workspace/channel identity.
- [ ] Extract message timestamps, text, links, files, and thread relationships.
- [ ] Detect SSO expiry and pause.
- [ ] Add fixtures, shadow mode, health, checkpoints, and backfill limits.

### Exit criteria

- The selected path completes a shadow-validation period.
- SSO/token expiry is detectable and recoverable.
- Threads do not multiply page/API traffic unnecessarily.

### Suggested vibe-coding prompt

> Implement Phase 10 on the VPS using [official API/browser fallback]. Reuse shared event, checkpoint, health, signing, browser-lease, and fixture infrastructure. Read only the configured channel, filter thread roots before fetching replies, use the private re-authentication path, and add shadow-mode validation.

## 16. Phase 11 — reliability, observability, and operations

### Objective

Make failures visible, recoverable, and routine to operate.

### Your work

- [ ] Choose where alerts should go.
- [ ] Approve backup retention and cost.
- [ ] Perform one real database restore test with guidance.
- [ ] Perform one browser re-authentication drill.
- [ ] Confirm alerts are understandable and not noisy.

### Coding-agent work

- [ ] Implement WF-07 reconciliation:
  - expired leases
  - stuck raw events
  - due outbox retries
  - stale source health
  - orphaned records
- [ ] Add structured metrics from design section 13.
- [ ] Add correlation IDs.
- [ ] Add dead-letter views and replay commands.
- [ ] Add log redaction tests.
- [ ] Verify and harden the Phase 7 database backup/restoration implementation.
- [ ] Add data-retention jobs.
- [ ] Add VPS disk, memory, swap, load, and container-health alerts.
- [ ] Alert when the latest encrypted backup exceeds 26 hours old.
- [ ] Add a global browser-lease watchdog.
- [ ] Add runbooks for:
  - connector stale
  - re-authentication required
  - selector broken
  - GitHub parser drift
  - Discord output failure
  - database restore
  - secret rotation
  - event replay
- [ ] Add dependency and container-image scanning.

### Failure drill

Verify these scenarios deliberately:

- Stop n8n for 15 minutes.
- Stop the collector after extraction but before acknowledgement.
- Expire a browser session.
- Break a fixture selector.
- Return Discord `429` and `5xx`.
- Restart Postgres.
- Replay a day of raw events.
- Reboot the VPS and verify automatic recovery.
- Fill a test filesystem near its warning threshold.
- Disconnect the Mac for the full drill and verify no runtime dependency.

### Exit criteria

- Every failure has an alert, owner action, and recovery path.
- Replays do not duplicate feed messages.
- Restore procedure has been tested, not merely documented.
- VPS reboot recovery and off-host backup freshness are verified.

### Suggested vibe-coding prompt

> Implement Phase 11 on the VPS. Add reconciliation, stale-source detection, VPS/container resource metrics, backup-age alerts, browser-lease watchdogs, correlation IDs, dead-letter/replay tooling, retention, restore validation, redaction tests, and operational runbooks. Run safe failure drills, including a VPS reboot and Mac disconnection, and report evidence.

## 17. Phase 12 — production activation

### Objective

Promote the already-deployed and shadow-tested VPS system to normal production delivery. This phase is activation and final validation, not initial infrastructure provisioning.

### Your work

- [ ] Review each source's shadow-mode report.
- [ ] Confirm the current estimated bill is within $7–$15/month.
- [ ] Confirm production credentials and browser sessions are current.
- [ ] Confirm the latest backup and restore drill succeeded.
- [ ] Approve GitHub delivery first.
- [ ] Approve browser-source delivery one connector at a time.
- [ ] Keep the Mac shut down during an overnight production validation.

### Coding-agent work

- [ ] Produce a release-candidate image set with immutable version tags.
- [ ] Record deployed application, workflow, parser, prompt, and adapter versions.
- [ ] Run migration preflight and create a fresh backup.
- [ ] Run the complete production smoke suite.
- [ ] Validate service resource use under one active Chromium workload.
- [ ] Validate all source-health and destination alerts.
- [ ] Enable delivery with configuration flags, not code edits.
- [ ] Observe each connector before enabling the next.
- [ ] Create rollback commands that restore the previous images and workflow exports.
- [ ] Produce a final operations handoff checklist.

### Release sequence

1. Verify backups, credentials, sessions, and source health.
2. Freeze the release versions.
3. Run migrations and smoke tests.
4. Enable GitHub delivery.
5. Observe for 24 hours.
6. Enable Discord browser delivery.
7. Observe for 24 hours.
8. Enable Instagram delivery.
9. Observe and verify story coverage.
10. Enable Slack delivery.
11. Keep the Mac off overnight and verify uninterrupted operation.

### Exit criteria

- All services survive restart.
- Browser profiles and Postgres data persist.
- Backups run.
- Alerts reach operations.
- No source is enabled without shadow validation.
- Continuous operation does not depend on the Mac.
- Monthly projected spend remains within the approved budget.
- Rollback has a documented, tested command path.

### Suggested vibe-coding prompt

> Execute Phase 12 as a controlled activation of the existing VPS deployment. Freeze versions, verify backup and migration preflight, run smoke tests, enable delivery one connector at a time with 24-hour observation gates, validate Mac-independent operation and budget, and prepare rollback evidence. Stop for my explicit approval before each connector is enabled.

## 18. Phase 13 — Notion tracking

### Objective

Add Notion as a projection for application tracking without making it pipeline state.

### Your work

- [ ] Create the Notion database.
- [ ] Choose fields and views.
- [ ] Create the Notion integration and grant only database access.
- [ ] Enter the token into n8n.

### Coding-agent work

- [ ] Create a separate Notion delivery outbox.
- [ ] Build WF-08 Notion Sync.
- [ ] Upsert by immutable opportunity ID.
- [ ] Map application states separately from source status.
- [ ] Retry without blocking Discord delivery.
- [ ] Add reconciliation for missing Notion pages.

### Exit criteria

- Notion outage cannot stop source ingestion or Discord.
- Repeated syncs do not create duplicate pages.
- User-entered application status is preserved.

## 19. Recommended vibe-coding rhythm

### Start of a phase

Ask the agent to:

1. Read the design and this phase.
2. Inspect existing code.
3. State assumptions and blockers.
4. Implement only the selected phase.
5. Run proportionate tests.
6. Summarize changed files and manual steps.

### During implementation

- Keep one conversation focused on one phase or failure.
- Give exact error output instead of paraphrasing it.
- Let the agent read current files rather than pasting stale code.
- Ask for tests whenever a parser or selector changes.
- Keep live-account actions manual.
- Never ask the agent to place a secret in code.

### Before each commit

- Review the diff.
- Run lint, typecheck, unit tests, and relevant integration tests.
- Complete the phase's manual test.
- Update fixtures and docs.
- Confirm no secrets or browser data are tracked.
- Commit only after explicitly requesting it.

## 20. Cross-phase definition of done

A phase is complete only when:

- Acceptance criteria pass.
- New behavior has automated tests.
- Logs are structured and redact sensitive values.
- Errors have stable categories and actionable messages.
- Retried operations are idempotent.
- Configuration is documented with examples.
- Secrets remain external.
- Relevant runbooks are updated.
- The next phase does not depend on undocumented manual state.

## 21. Immediate next step

Complete Phase 0 before scaffolding. The minimum answers needed are:

1. First GitHub repository and file.
2. First Discord source channel.
3. First Instagram account.
4. Slack workspace/channel and whether app installation is allowed.
5. Opportunity scope and filters.
6. VPS provider, x86 2-vCPU/4-GB plan, and region.
7. Backup destination.
8. Preferred model provider and monthly budget.

The runtime decision is already fixed: local development is temporary, while production uses self-hosted n8n, Postgres, bot, and collectors on one private VPS. After the remaining Phase 0 decisions, Phase 1 can be implemented almost entirely by the coding agent.

# ADR 0001: VPS-first low-cost runtime

**Status:** Accepted  
**Date:** July 29, 2026

## Context

The aggregator must poll sources continuously, including Instagram stories that may disappear after 24 hours. The operator does not want to keep a Mac online. The production budget should remain near $10 per month.

The runtime includes n8n, PostgreSQL, a Discord bot, Playwright/Chromium collection, local OCR, and backup jobs. Browser automation creates short memory spikes and requires persistent authenticated profiles.

## Decision

Run the complete production system on one cost-optimized x86 Ubuntu VPS:

- 2 shared vCPU
- 4 GB RAM
- 40 GB or more SSD
- 2 GB swap
- Hetzner is the default provider
- expected VPS cost is $7–$12/month

Self-host:

- n8n Community Edition
- PostgreSQL
- Discord bot
- collector service
- local OCR

Use:

- Docker Compose
- Tailscale-only administration
- on-demand private noVNC for browser authentication
- nightly encrypted Postgres backups to Cloudflare R2 or equivalent
- global browser leasing to serialize memory-heavy browser workloads

Do not expose n8n or PostgreSQL publicly. Do not back up browser profiles; manually authenticate again after disaster recovery.

The Mac remains a development and administration client only.

## Alternatives considered

### Keep the Mac online

Rejected because it conflicts with the operator's availability requirement and makes story coverage dependent on a personal computer.

### n8n Cloud plus managed Postgres and separate bot/collector hosting

Rejected initially because it creates multiple recurring bills and still requires separate Playwright compute.

### One 1–2 GB VPS

Rejected because Chromium and n8n leave insufficient memory headroom.

### ARM VPS

Deferred. ARM can be cheaper, but x86 reduces Playwright/Chromium compatibility friction during the first implementation.

### Apify-hosted scrapers

Rejected initially because of variable usage charges and third-party custody of authenticated session material.

## Consequences

Positive:

- Production continues while the Mac is off.
- Monthly cost should remain within $7–$15.
- One deployment and one operational surface.
- Private administration does not require a domain.

Negative:

- The VPS is a single failure domain.
- PostgreSQL is self-managed.
- Browser workloads must be serialized.
- Provider outage affects the complete pipeline.
- Disaster recovery requires browser re-authentication.

## Revisit triggers

Reconsider this decision if:

- sustained memory exceeds 80%
- swap is used continuously
- browser schedules cannot meet latency targets when serialized
- database size approaches disk limits
- monthly availability falls below 99%
- operating burden exceeds the cost of managed services

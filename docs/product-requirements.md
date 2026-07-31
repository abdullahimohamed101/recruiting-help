# Internship Aggregator — Product Requirements

**Status:** Phase 0 approved baseline  
**Approved:** July 29, 2026  
**Architecture:** [Detailed Design](internship-opportunity-aggregator-design.md)  
**Execution plan:** [Project Phases](internship-aggregator-project-phases.md)

## 1. Product objective

Continuously collect 2027 United States and remote-US internship/co-op opportunities from configured GitHub, Discord, Instagram, and Slack sources; normalize and deduplicate them; then publish useful alerts into an operator-owned Discord server.

Notion tracking is deferred until the collection and Discord delivery pipeline is stable.

## 2. Initial scope

### Included

- Internships
- Co-ops
- All 2027 recruiting seasons
- United States locations
- Roles explicitly marked remote-US
- Roles with unknown sponsorship status
- Roles that explicitly do not sponsor or require citizenship, provided they are visibly tagged

### Excluded initially

- New-grad roles
- Roles outside the United States unless explicitly remote-US
- Opportunities for years other than 2027
- Automatic applications
- Resume tailoring
- Candidate ranking
- Public redistribution

## 3. Filtering behavior

### Geography

Accept:

- United States city/state locations
- United States nationwide
- Remote US / US remote
- Remote roles that are clearly open to US applicants

Reject or route to review:

- Canada-only roles
- International-only roles
- Ambiguous `Remote` roles with no country evidence
- Multi-location roles where no US location is present

### Sponsorship and citizenship

Do not suppress opportunities solely because they lack sponsorship.

Normalize and display:

- `unknown`
- `offers_or_considers`
- `does_not_offer`
- `us_citizenship_required`

For the first GitHub source:

- `🛂` means `does_not_offer`
- `🇺🇸` means `us_citizenship_required`

If both are absent, status remains `unknown`; do not infer sponsorship.

### Opportunity status

- Open opportunities may enter the main feed.
- Explicitly closed opportunities (`🔒`) are stored for source-state reconciliation but are not published as new alerts.
- Missing application links route to review unless another trusted source supplies the link.
- Removed rows require two consecutive successful source observations before being considered closed.

## 4. Initial source inventory

### GitHub

| Field               | Value                                              |
| ------------------- | -------------------------------------------------- |
| Repository          | `vanshb03/Summer2027-Internships`                  |
| URL                 | https://github.com/vanshb03/Summer2027-Internships |
| Default branch      | `dev`                                              |
| Initial file        | `README.md`                                        |
| Optional later file | `OFFSEASON_README.md`                              |
| Poll interval       | 15 minutes                                         |
| Connector           | Official GitHub REST API with conditional requests |

Observed README schema:

```text
| Company | Role | Location | Application/Link | Date Posted |
```

Parser requirements:

- Parse the complete table after content changes.
- Treat `↳` as inheriting the nearest preceding non-arrow company.
- Extract `🛂`, `🇺🇸`, and `🔒` as structured status markers.
- Preserve multiple locations.
- Handle blank application cells.
- Normalize dates lacking a year to 2027 only when source context proves the year.
- Ignore contributor and navigation sections outside the internship table.
- Use a stable application URL when present; otherwise derive source identity from normalized row content plus repository/file.
- Preserve raw row evidence.

The source describes US, Canada, and remote positions. Product filtering narrows this to US and remote-US.

### Discord

| Field          | Value                                                                |
| -------------- | -------------------------------------------------------------------- |
| Channel URL    | https://discord.com/channels/1466113100465049753/1466118296574365831 |
| Guild ID       | `1466113100465049753`                                                |
| Channel ID     | `1466118296574365831`                                                |
| Poll interval  | 3 minutes                                                            |
| Connector      | VPS-hosted Playwright browser adapter                                |
| Authentication | Dedicated alternate account; manual login                            |

The adapter reads only the configured channel. Manual forwarding to the owned intake channel remains the fallback.

### Instagram

| Field          | Value                                                            |
| -------------- | ---------------------------------------------------------------- |
| Profile        | `zero2sudo`                                                      |
| URL            | https://www.instagram.com/zero2sudo/                             |
| Content        | Posts, reels, and stories                                        |
| Poll interval  | 10 minutes                                                       |
| Connector      | VPS-hosted Playwright adapter with local OCR and Gemini fallback |
| Authentication | Dedicated alternate account; manual login                        |

Temporary story images are deleted after extraction unless the event requires human review.

### Slack

| Field               | Value                                                    |
| ------------------- | -------------------------------------------------------- |
| Workspace           | `colorstack-family`                                      |
| Channel URL         | https://colorstack-family.slack.com/archives/C011H0EFU14 |
| Channel ID          | `C011H0EFU14`                                            |
| Poll interval       | 5 minutes                                                |
| Preferred connector | Official Slack API if app installation succeeds          |
| Fallback connector  | VPS-hosted Playwright adapter                            |

Slack app-installation permission remains to be tested manually before Phase 10.

## 5. Output requirements

### Discord channels

Create in the operator-owned server:

- `#opportunity-intake`
- `#internship-feed`
- `#aggregator-review`
- `#aggregator-ops`

### Main-feed alert

Include when known:

- Company
- Role
- Locations
- Internship/co-op type
- Season/year
- Application URL
- Deadline
- Sponsorship/citizenship status
- Source and source link
- Confidence
- Date discovered

Disable all mentions in generated messages.

### Review routing

Send to review when:

- application URL is missing
- company or role is missing
- location cannot be evaluated against the US filter
- year is ambiguous
- extraction confidence is below threshold
- fuzzy duplicate detection is inconclusive

## 6. Runtime and cost requirements

Production uses one low-cost x86 VPS:

- 2 shared vCPU
- 4 GB RAM
- at least 40 GB SSD
- 2 GB swap
- Ubuntu LTS
- Hetzner cost-optimized x86 plan is the selected default

Monthly budget:

- VPS: $7–$12 target
- AI: $0–$2
- encrypted off-host backup: $0–$1
- total guardrail: $7–$15

Production components:

- self-hosted n8n Community Edition
- private signed-intake API
- PostgreSQL on the VPS
- Discord bot
- Playwright collector
- local OCR
- backup/reconciliation jobs

The operator's Mac is not an always-on dependency.

## 7. Access, administration, and backup

- Tailscale provides private VPS administration.
- n8n and PostgreSQL are not exposed publicly.
- Browser login uses an on-demand private headed/noVNC session.
- CAPTCHA, MFA, SSO, and account challenges are completed manually.
- Cloudflare R2 or an equivalent low-cost S3-compatible service is the selected backup destination.
- PostgreSQL backups run nightly with seven daily and four weekly copies.
- Browser profiles are not backed up; disaster recovery requires manual re-authentication.

## 8. AI requirements

Use a provider-neutral extraction interface.

Initial provider:

- Gemini free tier

Ordering:

1. Deterministic parser/filter
2. Local OCR for images
3. Gemini structured text or vision extraction only when required
4. Human review when confidence remains insufficient

Guardrails:

- monthly paid-overage cap defaults to zero
- source content is untrusted
- extracted URLs must exist in source evidence
- free-tier data-handling implications must be accepted before sending restricted-community content

## 9. Success metrics

- At least 95% precision for the first GitHub source.
- No fixture opportunities missed.
- Same application URL across sources produces one main-feed alert.
- GitHub-to-Discord latency under 15 minutes.
- Discord-source latency under 5 minutes when healthy.
- Instagram/Slack latency under 15 minutes when healthy.
- Browser challenges and collection gaps are visible.
- No public n8n/Postgres exposure.
- Production continues overnight while the Mac is off.
- Monthly projected cost remains within $7–$15.

## 10. Remaining decisions

These are intentionally deferred to their implementation phases:

- Exact Hetzner region and current qualifying x86 plan
- Slack app-installation outcome
- Operator-owned Discord server/channel IDs
- Gemini model selected after extraction evaluation
- Confidence thresholds based on fixture results
- Whether `OFFSEASON_README.md` should be enabled after the primary README parser stabilizes

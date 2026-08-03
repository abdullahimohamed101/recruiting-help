# GitHub connector (Phase 6)

Polls curated internship READMEs via the GitHub Contents API, inserts one raw
event per table row, and advances ETag/SHA cursors only after durable inserts.

## Default source

Configured in `config/sources.example.yaml`:

- Repository: `vanshb03/Summer2027-Internships`
- Branch: `dev`
- Files: `README.md`, `OFFSEASON_README.md`
- Parser: `vanshb03_markdown_table_v1`
- `shadow_mode: true` (store + process, **do not** enqueue Discord delivery)

Copy to `config/sources.yaml` for local overrides. Never put tokens in YAML.

## Runtime

- Service: `apps/github-poller` on `http://github-poller:3003`
- `POST /v1/poll-github` — poll enabled GitHub sources
- n8n: `WF-01 GitHub Poll` every 15 minutes
- CLI: `corepack pnpm github:poll` (optional `--source-id …`)

Optional `GITHUB_TOKEN` raises API rate limits. Unauthenticated polling works for
public repos at lower limits.

## Behavior

| Case                   | Result                                            |
| ---------------------- | ------------------------------------------------- |
| `304 Not Modified`     | Update health / `last_success_at` only            |
| `200` changed          | Parse full snapshot → insert rows → save ETag/SHA |
| Persist failure        | Cursor **not** advanced                           |
| Header drift           | Source disabled + `selector_broken` health        |
| Rate limit             | `rate_limited` health; cursor preserved           |
| Missing from one poll  | Opportunity → `possibly_removed`                  |
| Missing from two polls | Opportunity → `closed`                            |

Shadow mode is toggled in source config (`shadow_mode: false`) without code
changes. Continuous 48-hour shadow validation is deferred to Phase 7 (VPS).

## Fixtures

Redacted samples live under
`packages/test-fixtures/github/vanshb03-summer2027/`.

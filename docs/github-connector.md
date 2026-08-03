# GitHub connector (Phase 6)

Polls curated internship READMEs via the GitHub Contents API, inserts one raw
event per table row, and advances ETag/SHA cursors only after durable inserts.

The connector is **source-modular**: each internship input is a YAML `sources`
entry with a registered parser id. Adding a compatible list usually needs no
code — only config.

## Default source

Configured in `config/sources.example.yaml`:

- Repository: `vanshb03/Summer2027-Internships`
- Branch: `dev`
- Files: `README.md`, `OFFSEASON_README.md`
- Parser: `vanshb03_markdown_table_v1`
- `shadow_mode: true` (store + process, **do not** enqueue Discord delivery)

Copy to `config/sources.yaml` for local overrides. Never put tokens in YAML.

## Adding internship inputs

### 1. Same table shape (config only)

1. Copy a GitHub block in `config/sources.yaml`.
2. Set a unique `id`, `repository`, `branch`, and `files[].path`.
3. Choose a parser:
   - `vanshb03_markdown_table_v1` — Vansh-style 5-column table
   - `markdown_table_v1` — generic; set `parser_options` columns/headers
4. Keep `shadow_mode: true` until the rows look right.
5. Restart `github-poller` / run `corepack pnpm github:poll -- --source-id <id>`.

Per-file `parser_options` override source-level options (headers, column indexes,
inherited-company marker).

### 2. New table / list shape (small code)

1. Add a parser in `packages/github/src/parsers.ts` via `registerSnapshotParser`
   (or a dedicated module imported from there).
2. Reuse `parseMarkdownTableSnapshot` when it is still a markdown table.
3. Point the new YAML source at that parser id.
4. Add fixtures under `packages/test-fixtures/github/<source-id>/`.

Poll orchestration, cursors, health, observations, and shadow mode stay shared.

### 3. Non-GitHub inputs later

Discord / Instagram / Slack stay separate `type:` values in the same
`sources` file. They do not go through `github-poller`; they use their own
connectors but share intake → processing → outbox.

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
| Persist failure        | Cursor **not** advanced; CLI `detail` has DB error |
| Duplicate locked rows  | Observation keys deduped (same URL/row hash)      |
| Header drift           | Source disabled + `selector_broken` health        |
| Rate limit             | `rate_limited` health; cursor preserved           |
| Missing from one poll  | Opportunity → `possibly_removed`                  |
| Missing from two polls | Opportunity → `closed`                            |

Shadow mode is toggled in source config (`shadow_mode: false`) without code
changes. Continuous 48-hour shadow validation is deferred to Phase 7 (VPS).

## Fixtures

Redacted samples live under
`packages/test-fixtures/github/vanshb03-summer2027/`.

# Discord bot

Phase 5 owned-server Discord bot for fallback intake, feed/review delivery, and ops alerts.

## Intents

Enable only:

- `GUILDS`
- `GUILD_MESSAGES`
- `MESSAGE_CONTENT`

Do not grant Administrator.

## Least-privilege invite

```bash
DISCORD_CLIENT_ID=<application-id> DISCORD_GUILD_ID=<owned-guild-id> \
  corepack pnpm discord:invite-url
```

Permission bits include view channel, send messages, embed links, attach files, read history, and add reactions.

## Channel matrix

| Channel               | Bot access                        |
| --------------------- | --------------------------------- |
| `#opportunity-intake` | View, read history, add reactions |
| `#internship-feed`    | View, send, embed                 |
| `#aggregator-review`  | View, send, embed                 |
| `#aggregator-ops`     | View, send, embed                 |

Restrict the bot to these four channels in the Discord UI.

## Environment

Required for `corepack pnpm bot:dev` or Compose `--profile discord`:

- `DISCORD_BOT_TOKEN`
- `DISCORD_GUILD_ID`
- `DISCORD_INTAKE_CHANNEL_ID`
- `DISCORD_FEED_CHANNEL_ID`
- `DISCORD_REVIEW_CHANNEL_ID`
- `DISCORD_OPS_CHANNEL_ID`
- `DATABASE_URL`
- `INTAKE_URL` (Compose pins the bot to WF-02: `http://n8n:5678/webhook/unified-intake`; do not reuse the host `127.0.0.1` CLI value inside the bot container)
- `AGGREGATOR_CALLER_ID` / `AGGREGATOR_CALLER_SECRET`
- `DISCORD_GUILD_ID` (Compose injects this into intake-api’s callers allow-list)

Allow-list the bot caller for:

- `discord_manual` → owned guild ID
- `slack_manual` / `instagram_manual` → `discord-intake` (prefix overrides from intake)

## Intake reactions

| Emoji | Meaning                                                                             |
| ----- | ----------------------------------------------------------------------------------- |
| `⏳`  | Intake accepted the message and is writing the raw event                            |
| `✅`  | New raw event stored (not yet “published to feed”)                                  |
| `♻️`  | Same Discord message / intake source identity already stored                        |
| `🔁`  | Opportunity already in the system (exact dedupe after processing; no new feed post) |
| `❌`  | Intake rejected or failed                                                           |

`🔁` is added by the processor via `POST /v1/react` after exact opportunity
dedupe. Intake cannot know opportunity duplicates up front, so you still see
`✅` first, then `🔁` once WF-03 / processing links the existing opportunity.

## Runtime endpoints

Private Docker network only:

- `GET /healthz`
- `GET /readyz`
- `POST /v1/deliver-batch`
- `POST /v1/ops-alert`
- `POST /v1/react` (`channel_id`, `message_id`, `emoji`)

## Manual verification

1. Paste a fake opportunity into `#opportunity-intake`.
2. Confirm `⏳`, then `✅`.
3. Run processing + delivery (WF-03 / WF-04 or CLI) and confirm one feed message.
4. Submit the same text again (same Discord message is a new event; for duplicate source identity, resend an identical signed event or re-process an exact URL duplicate path).
5. Confirm duplicate source intake shows `♻️` when the same Discord message id is retried through intake.
6. Paste a job URL that already exists as an opportunity; confirm `✅` then `🔁`, and no second feed outbox row.
7. Submit an incomplete item.
8. Confirm it appears in `#aggregator-review`, not the feed.

URL-only pastes are first-class. Drop a job link (Ashby, SmartRecruiters, Lever,
Greenhouse, Rippling, etc.) and the bot will store it. Processing fetches the
posting page (SSRF-safe trusted GET), reads JobPosting/OG fields, then extracts
company/role/location/season/year. Extra Discord context is optional:

```text
https://jobs.smartrecruiters.com/WesternDigital/...

# or with hints:
Remote US — Western Digital SWE intern
https://jobs.smartrecruiters.com/WesternDigital/...
```

If the page fetch fails or company/role are still missing, the item goes to
`#aggregator-review`. Ensure WF-03 and WF-04 are published (or run
`corepack pnpm process:events -- --limit 10`).

## Local commands

```bash
corepack pnpm db:migrate
corepack pnpm infra:up
corepack pnpm infra:up:discord
corepack pnpm n8n:import
corepack pnpm n8n:publish:wf02
corepack pnpm n8n:publish:wf03
corepack pnpm n8n:publish:wf04
corepack pnpm n8n:publish:wf06
```

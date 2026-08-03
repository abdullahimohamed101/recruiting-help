# n8n workflows

Version-controlled workflow exports live in `workflows/`.

Rules:

- Never export credential values.
- Review workflow JSON before committing it.
- Pin workflow schema/version metadata where n8n supports it.
- Treat the VPS instance as runtime state and Git exports as the recoverable definition.
- `corepack pnpm n8n:import` imports every workflow in the mounted directory.
- `corepack pnpm n8n:export` prints the current instance workflows for review.
- Imported workflows are inactive until explicitly published.
- `corepack pnpm n8n:publish:wf02` (and the other publish scripts) restart n8n
  after publish so production webhooks register.
- Discord bot intake stays on WF-02 (`http://n8n:5678/webhook/unified-intake`).
  Do not point the bot at host `127.0.0.1` from inside Compose.

Implemented:

- `WF-02 Unified Signed Intake`
- `WF-03 Process Raw Events`
- `WF-04 Deliver Discord Outbox` (feed **and** review; Phase 5 has no separate WF-05)
- `WF-06 Error Handler`

Review items are `discord_review` outbox rows delivered by WF-04 to
`#aggregator-review`. Do not expect a `wf-05-*.json` export in this repo.

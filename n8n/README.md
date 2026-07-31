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

Implemented:

- `WF-02 Unified Signed Intake`
- `WF-03 Process Raw Events`
- `WF-04 Deliver Discord Outbox`
- `WF-06 Error Handler`

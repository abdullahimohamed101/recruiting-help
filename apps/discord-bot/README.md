# Discord bot

Owned-server Discord bot for Phase 5:

- Gateway intake from `#opportunity-intake` with status reactions (`⏳`/`✅`/`♻️`/`❌`; processor adds `🔁` for already-submitted opportunities)
- Signed submission to WF-02
- Outbox delivery for feed and review channels via `POST /v1/deliver-batch`
- Ops alerts via `POST /v1/ops-alert`
- Intake reactions via `POST /v1/react` (used by the processor for exact duplicates)

See [Discord bot setup](../../docs/discord-bot.md).

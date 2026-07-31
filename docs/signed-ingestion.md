# Signed unified ingestion

Phase 3 accepts canonical raw events from trusted project services and persists each source event exactly once.

## Request path

```text
connector or bot
  -> POST /webhook/unified-intake on n8n
  -> exact binary forwarding on the private Docker network
  -> intake-api verification and validation
  -> atomic nonce + raw_events PostgreSQL transaction
```

The intake API has no published host port. n8n is the only webhook edge.

## Signature protocol

Required headers:

- `X-Aggregator-Caller`
- `X-Aggregator-Timestamp`: ten-digit Unix seconds
- `X-Aggregator-Nonce`: 16–128 URL-safe characters
- `X-Aggregator-Signature`: `v1=<64 lowercase hex characters>`

Signing input:

```text
v1.<caller>.<timestamp>.<nonce>.<exact raw body bytes>
```

The signature is HMAC-SHA256 with the caller's dedicated secret. Caller, timestamp, nonce, and body are all cryptographically bound.

Rules:

- maximum clock difference: five minutes in either direction
- nonce lifetime: ten minutes
- maximum request body: 256 KiB
- maximum attachment metadata: 64 KiB
- caller/source-account combinations must be allow-listed
- signatures are compared in constant time after fixed-format validation
- source payloads must satisfy the strict raw-event contract

Do not sign `JSON.stringify()` output that differs from the bytes sent over HTTP.

## Responses

Successful new event:

```json
{
  "accepted": true,
  "duplicate": false,
  "raw_event_id": "uuid"
}
```

Successful retry with a fresh nonce:

```json
{
  "accepted": true,
  "duplicate": true,
  "raw_event_id": "same uuid"
}
```

Safe error codes include:

- `unauthorized`
- `stale_timestamp`
- `replayed_nonce`
- `source_not_allowed`
- `validation_error`
- `payload_too_large`
- `attachment_metadata_too_large`
- `persistence_unavailable`

Responses and logs never include signatures, secrets, or source payloads.

## Local setup

Copy the safe template and replace its development placeholders if the environment will be shared:

```bash
cp .env.example .env
corepack pnpm secret:generate
```

Place the generated value in:

```text
AGGREGATOR_CALLER_SECRET=...
```

Development Compose passes `AGGREGATOR_CALLERS_JSON` from `.env` (with an inline
default). Keep that value as **unquoted** JSON in `.env` — no surrounding
`'`/`"` — and avoid macOS TextEdit smart quotes, which corrupt the string and
crash `intake-api` on `JSON.parse`. Production also requires
`AGGREGATOR_CALLERS_JSON`.

Start services and migrate:

```bash
corepack pnpm infra:up
corepack pnpm db:migrate
```

Import and publish WF-02:

```bash
corepack pnpm n8n:import
corepack pnpm n8n:publish:wf02
```

`n8n:publish:wf02` restarts n8n so the production webhook registers. Imported
workflows stay inactive until publish.

### Discord bot → WF-02 networking

The bot must call `http://n8n:5678/webhook/unified-intake` on the Compose
network. Host `.env` often sets `INTAKE_URL=http://127.0.0.1:5678/...` for CLI
scripts; Compose intentionally does **not** pass that value into the bot
container (it would yield `fetch failed`).

Verify from inside the bot container:

```bash
docker compose --env-file .env -f infra/compose.dev.yaml exec discord-bot printenv INTAKE_URL
docker compose --env-file .env -f infra/compose.dev.yaml exec -T discord-bot \
  node -e "fetch('http://n8n:5678/webhook/unified-intake',{method:'POST',headers:{'content-type':'application/json'},body:'{}'}).then(async r=>console.log(r.status, await r.text())).catch(e=>console.error(e.message,e.cause))"
```

- Connection error → n8n not reachable / wrong hostname
- `404` + “webhook is not registered” → publish WF-02 and wait for n8n healthy
- `401`/`403` JSON from intake → signature or allow-list (WF-02 is working)

Send a test event:

```bash
corepack pnpm intake:send -- --event-id phase3-manual-test
```

Sending the same event ID again with a fresh automatically generated nonce should return `duplicate: true` and the same raw-event ID.

## Caller registry

Production caller configuration is a secret JSON environment value:

```json
{
  "collector-prod": {
    "secret": "generated-secret",
    "allowed_sources": {
      "github": ["vanshb03/Summer2027-Internships"]
    }
  }
}
```

Each bot or collector receives a separate caller ID and secret. Never commit the real registry.

## Failure behavior

- Invalid authentication and validation never reach PostgreSQL.
- Nonce insertion and raw-event insertion use one transaction.
- A database failure rolls back nonce consumption.
- Reusing a nonce is rejected.
- Retrying the same source event with a new nonce returns duplicate success.
- n8n stores no successful or failed WF-02 execution payloads.
- The intake API logs only safe status codes.

## Workflow source

The importable definition is:

`n8n/workflows/wf-02-unified-signed-intake.json`

It forwards n8n's binary `data` property. Changing the node to parsed JSON or a stringified object would break exact-byte verification and must fail review.

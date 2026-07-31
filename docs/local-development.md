# Local development

Local services are temporary development dependencies. Production runs continuously on the VPS described in the [design](internship-opportunity-aggregator-design.md).

## Requirements

- Node.js 22 or newer
- Corepack
- pnpm 11
- Docker with Compose

## Setup

```bash
corepack pnpm install
cp .env.example .env
corepack pnpm env:check
corepack pnpm infra:up
corepack pnpm infra:status
corepack pnpm db:migrate
```

Local endpoints bind only to loopback:

- n8n: http://127.0.0.1:5678
- PostgreSQL: `127.0.0.1:5432`

`intake-api`, `processor`, and `discord-bot` stay on the Docker network only. Start the Discord bot with:

```bash
corepack pnpm infra:up:discord
```

after setting Discord token and channel IDs in `.env`.

## Checks

```bash
corepack pnpm check
corepack pnpm infra:config
```

Database integration tests use a separate database and refuse names without the `_test` suffix. See [Database and Contracts](database.md) for setup and commands.

## Stop or reset

Stop containers while preserving development data:

```bash
corepack pnpm infra:down
```

Delete local Postgres and n8n volumes:

```bash
corepack pnpm infra:reset
```

`infra:reset` is destructive only to local development volumes. It is not used against production.

## Environment files

- `.env.example`: safe development template
- `.env`: ignored local values
- `infra/env.example`: safe production template
- `.env.production`: ignored VPS values; mode `0600`

Never commit tokens, cookies, browser profiles, n8n credentials, backup keys, or production environment files.

## Processing locally

After ingesting a raw event:

```bash
corepack pnpm process:events -- --limit 10
```

Or run the private processor HTTP service:

```bash
corepack pnpm process:dev
```

Import and publish WF-03 when you want n8n to drive the processor on a schedule:

```bash
corepack pnpm n8n:import
corepack pnpm n8n:publish:wf03
```

See [Processing core](processing.md).

## Current phase boundaries

The repository includes Phase 5 Discord intake/delivery (bot, WF-04, WF-06). It does not yet include:

- source collectors (GitHub / browser)
- production VPS provisioning

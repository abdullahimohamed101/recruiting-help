# GitHub poller

Phase 6 service that conditionally polls configured GitHub README sources and
inserts row-level raw events.

- `GET /healthz`, `GET /readyz`
- `POST /v1/poll-github`

See [GitHub connector](../../docs/github-connector.md).

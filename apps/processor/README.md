# Processor

Private HTTP service for Phase 4 raw-event processing.

n8n WF-03 calls `POST /v1/process-batch` on the Docker network. The service is not published to the host.

Endpoints:

- `GET /healthz`
- `GET /readyz`
- `POST /v1/process-next`
- `POST /v1/process-batch`

Optional environment:

- `GEMINI_API_KEY` — enables AI fallback when deterministic parsers fail
- `FEED_DESTINATION_KEY` — outbox destination key (default `internship-feed`)
- `AUTO_PUBLISH_CONFIDENCE` — minimum confidence for auto-publish (default `0.85`)
- `RESOLVE_REDIRECTS` — set `true` to follow application-URL redirects with SSRF protections

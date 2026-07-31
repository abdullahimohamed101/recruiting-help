# ADR 0002: Private intake API behind n8n

**Status:** Accepted  
**Date:** July 30, 2026

## Context

WF-02 must verify an HMAC over the exact HTTP body, enforce caller/source allow-lists, atomically consume replay nonces, validate the shared Zod contract, and insert a raw event exactly once.

Implementing this in an n8n Code node would either duplicate security logic or expose runtime secrets to workflow expressions. Database failure between separate n8n nodes could also consume a nonce without persisting its event.

## Decision

n8n remains the edge webhook and orchestration surface. It:

1. Receives the signed request with raw-body mode enabled.
2. Preserves the body as n8n binary data.
3. Forwards the exact body and four signed headers to `intake-api` over the private Compose network.
4. Returns the intake API's status and safe JSON response.

The TypeScript intake API:

- is not published to the host or internet
- owns caller HMAC secrets
- uses the shared runtime contracts
- performs constant-time verification
- binds caller, timestamp, nonce, and exact body bytes
- atomically inserts the nonce and raw event in PostgreSQL
- logs only safe rejection codes

## Consequences

Positive:

- Security logic is unit- and integration-tested TypeScript.
- n8n workflow JSON contains no secret.
- Nonce consumption and event persistence share one transaction.
- Future collectors use one shared signing library.

Negative:

- One additional small container runs in production.
- n8n and the API must both be healthy for intake.
- The workflow must use binary forwarding; JSON reserialization is forbidden.

## Alternatives considered

### HMAC verification in an n8n Code node

Rejected because it duplicates contract/security code and requires workflow access to environment secrets.

### Expose the intake API directly

Rejected because n8n is the planned webhook/orchestration boundary and provides a consistent operational entry point.

### Sign parsed/re-serialized JSON

Rejected because equivalent JSON can have different byte representations. Verification must use the exact transmitted bytes.

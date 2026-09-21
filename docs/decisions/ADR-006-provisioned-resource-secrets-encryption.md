# ADR-006: App-Level Encryption for Provisioned-Resource Secrets

**Status**: accepted
**Date**: 2026-09-21
**Deciders**: Aziz

## Context

Infra provisioning (Railway, Neon, Cloudflare — PRD P2) mints resources on behalf of an endorsed member project: a Railway service, a Neon database, a Cloudflare DNS record. Some of these hand back a credential — a Neon connection string, a Railway deploy token — that has to be stored somewhere and eventually shown to the project owner.

This is a different population of secrets from what the app already handles. `RAILWAY_API_TOKEN`, `NEON_API_KEY`, `CLOUDFLARE_API_TOKEN`, `ANTHROPIC_API_KEY`, etc. are the platform's own credentials and already live as Railway-managed env vars (`apps/api/src/env.ts`) — that pattern is accepted and out of scope here. What's new is a credential generated *per provisioned resource, for a member's project*, with nowhere safe to live. The naive option — dropping it into `provisionedResources.config` (jsonb) — would serialize straight into any `GET /infra/...` response for anyone with `read Infra`.

The realistic threat this needs to survive is a Postgres (Neon) data leak — a SQL injection, a stolen `DATABASE_URL`, an over-permissioned read replica — not a targeted attack on Railway's own infrastructure. That threat model, more than anything else, decided the approach below.

## Decision

Encrypt these secrets at the application layer with AES-256-GCM before they reach the database, using a dedicated `SECRETS_ENCRYPTION_KEY` (32-byte, hex-encoded) stored as its own Railway env var — separate from `DATABASE_URL` and every other credential.

- `resource_secrets` table stores `ciphertext` / `iv` / `authTag` per `(provisioned_resource_id, key)`, never plaintext.
- `apps/api/src/lib/crypto.ts` holds the pure encrypt/decrypt functions (no `db`/`env` import, so they unit-test without booting the app).
- `apps/api/src/services/secrets.service.ts` is the only code path that decrypts. It always writes an `audit_log` entry (`reveal`, `rotate`, `create`, `delete`).
- `GET /infra/resources/:id/secrets` returns metadata only (key, timestamps, last revealer) — never ciphertext, never plaintext.
- `POST /infra/resources/:id/secrets/:key/reveal` is the sole path to plaintext, gated on `provision Infra` (admin/superadmin only today) and audited on every call.

## Consequences

### Positive
- A database leak alone does not expose secrets — the decryption key lives in a separate credential store (Railway env vars), not in the rows that leaked.
- No new service to run, pay for, or keep available — fits the existing "one service, no extra moving parts" direction from ADR-005.
- Ships without any new vendor relationship or credential-to-protect-a-credential problem.

### Negative
- Key rotation is manual: re-encrypting existing rows under a new key is code we'd write for this specific need, not tooling we get for free.
- No access-policy layer beyond CASL + `audit_log` — no secret versioning, no time-boxed grants.

### Neutral
- `SECRETS_ENCRYPTION_KEY` is a required env var (unlike the optional provider tokens) — a deployment without it fails to boot rather than silently storing secrets some other, less safe way.

## Alternatives Considered

### Option A: External secrets manager (Vault, Infisical, Doppler)
- Pros: dedicated rotation tooling, access policies, secret versioning, an audit trail independent of our own Postgres.
- Cons: a new external dependency to run/pay for and keep available; a new root credential to protect (to talk to the manager itself); added latency in the provisioning path. Doesn't change the actual DB-leak scenario above, since the manager's own root credential would still sit in the same Railway env store either way. Revisit if MSOCIETY starts holding secrets for external/paying customers, or a compliance requirement appears.

### Option B: Don't store secrets in this app at all
- Pros: zero new attack surface in this codebase; Railway/Neon/Cloudflare stay the system of record for their own secrets.
- Cons: defeats the point of a self-service provisioning flow — an admin would have to hand-deliver credentials out of band every time, which is the manual process this feature exists to replace.

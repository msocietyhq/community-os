# ADR-008: Centralized PR Preview Environment Provisioning

**Status**: accepted — the project-bootstrap-token/preflight design below (Railway self-configuring itself at boot) is **superseded by ADR-009**, which manages Railway directly via its API instead. Everything else here (Neon branch provisioning, the `CI_SERVICE_TOKEN`/`ci/ensure`/`ci/teardown` split, `dev_environments.owner_id` resolution, `project_infra_configs`) still stands.
**Date**: 2026-09-21
**Deciders**: Aziz

## Context

ADR-007 built `dev_environments`/`shared_secrets` for contributors working on an endorsed project, but explicitly deferred live Neon branch provisioning — `DATABASE_URL` was set by hand via `PUT /dev-environments/:id/vars/:key`. Issue #52 picked that up for the specific case of PR preview databases (a Neon branch per open PR, wired into a Railway PR Environment), and two problems surfaced while building a first pass directly in this repo's own GitHub Actions:

1. Calling Neon/Railway APIs straight from a repo's CI requires `NEON_API_KEY`, `NEON_PROJECT_ID`, `RAILWAY_API_TOKEN`, `RAILWAY_PROJECT_ID`, `RAILWAY_SERVICE` as that repo's own GitHub secrets/variables. Every future endorsed project would need the same manual setup copy-pasted into its own repo settings, with workflow-file drift as fixes land in one copy but not another.
2. Railway's own API has a real auth constraint here: a project token is scoped to one *existing* environment at creation time, and a `pr-<n>` environment doesn't exist yet when CI would need to push into it — making a CI-driven Railway push fragile even for a single repo.

The exploratory implementation (Neon branch creation + a Railway CLI push from a repo-local workflow) was built, hit problem 2, and was deliberately removed before merging ADR-007's PR rather than landing something project-specific and partially working.

This also reopened a schema question ADR-007 didn't need to answer: `dev_environments.owner_id` is `NOT NULL`, a human. A CI-provisioned PR environment has no human triggering it.

## Decision

- **Neon branch provisioning becomes real** (`apps/api/src/integrations/neon.ts`): fork a branch off the project's default branch with a read-write endpoint, build its connection string via Neon's own connection-uri endpoint, and re-run this repo's Drizzle migrations against it (a fork copies schema+data already on the parent, but not migrations the PR itself just added).
- **Two separate bearer credentials, not one**, because they authenticate two different callers with different scopes:
  - `CI_SERVICE_TOKEN` — one org-wide value, this API's own env var, given to every endorsed project's GitHub Actions as one shared secret (`COMMUNITY_OS_CI_TOKEN`, inherited from the org, not set per repo). It authenticates `POST /dev-environments/ci/ensure` and `POST /dev-environments/ci/teardown` — CI telling us "make sure PR #n's environment exists" / "it's closed, tear it down." Compared with `timingSafeEqual` (`lib/crypto.ts`'s new `safeCompare`), not hashed-and-stored, since it's a single rotatable value rather than many mintable ones.
  - `project_bootstrap_tokens` — one long-lived, maintainer-rotatable token *per project* (new table, same hash-at-rest shape as `dev_environment_agent_keys`). This is the value a project's Railway service clones into every PR environment's env vars once, in Railway's dashboard (still a manual step — see Known Limitation). At boot, the app calls `POST /dev-environments/bootstrap` with this token plus its own `RAILWAY_ENVIRONMENT_NAME` (assumed to encode the PR number as `pr-<n>`) to self-configure before `env.ts` parses.
  - Reusing one token type for both would mean either handing CI a per-project secret (defeats the zero-repo-secrets goal) or handing every Railway PR environment the org-wide CI token (unnecessarily broad — a leaked preview-environment credential would then also be able to provision/teardown *any* project's previews, not just read its own bundle).
- **The reusable GitHub Actions workflow lives once, in this repo** (`.github/workflows/preview.yml`, `workflow_call`), calling `ci/ensure`/`ci/teardown`. A new project's own workflow file is ~5 lines (`uses: msocietyhq/community-os/.github/workflows/preview.yml@main` plus the one inherited secret) — see that file's header comment for the exact snippet.
- **Preflight, not a restructured boot sequence**: `env.ts` parses `process.env` synchronously the instant `index.ts`'s module graph loads (via a chain of eager static imports), before any `await` could run. Rather than converting ~19 files' worth of `env`/`db` consumers to dynamic imports, `apps/api/src/scripts/preflight.ts` runs as a distinct process step before the server starts (`bun run preflight && bun --env-file=.env.runtime ...`), writing what it resolves to `.env.runtime` for Bun to load. It reads `process.env` directly rather than importing `env.ts`, since that schema requires exactly the vars this script exists to supply.
- **Project-level infra identifiers** (which Neon project, which Railway project/service) live in a new `project_infra_configs` table — one row per project, non-secret identifiers only, matching the existing `provisioned_resources`/`resource_types` precedent of keeping identifiers in our own DB rather than per-repo config.
- **`dev_environments.owner_id` stays `NOT NULL`.** A CI-provisioned environment's owner is resolved from the PR: the PR author's GitHub login is matched against `members.github_handle` (case-insensitively) to find their community-os `user.id`; if there's no match (an external contributor with no account here), ownership falls to one seeded system/bot user (`user.id = 'system-bootstrap'`, inserted by this ADR's migration). This was chosen over making the column nullable because nullable ownership would have needed every existing reader of `dev_environments.owner_id` — CASL subject resolution, `list`'s own-vs-all filtering, revoke checks — updated to handle `null`, for a case (no human owner) that a single sentinel row already models cleanly.
- `dev_environments` gained `pr_number` and `neon_branch_id` columns so `ci/ensure` is idempotent (a still-active row for the same project+PR is returned as-is, no second branch) and `ci/teardown`/manual revoke know which Neon branch to delete.

## Consequences

### Positive
- A new endorsed project's repo needs zero Neon/Railway secrets and near-zero workflow code to get PR preview databases.
- No repository, including this one, ever holds a Neon or Railway credential — those stay this API's own env vars.
- Reuses ADR-006/007's encryption, hashing, and reveal-is-always-audited machinery rather than inventing a third secrets story.

### Negative
- The bootstrap token is the same value cloned into every one of a project's open PR environments (see Known Limitation below) — a residual, low-blast-radius risk accepted for this pass.
- One manual step remains per project: setting that bootstrap token in Railway's dashboard once. Automating it would need a Railway credential we don't yet have a safe way to hold.
- `preflight.ts`'s `RAILWAY_ENVIRONMENT_NAME` → PR-number parsing assumes a naming convention (`pr-<n>`) rather than a value Railway guarantees; if Railway's actual PR-environment naming differs, this needs adjusting before it works against a real Railway project.
- The Neon API integration (branch create/connection-uri/delete) could not be exercised against a live Neon project in this environment — it's implemented against Neon's documented API v2 shape but wants a live smoke test before production use.

### Neutral
- `env.ts` gained `CI_SERVICE_TOKEN` (optional, like the other infra credentials) — a deployment not using this feature yet still boots fine.

## Alternatives Considered

### Option A: One shared bootstrap-token type for both CI and Railway
- Pros: one fewer concept, one fewer table.
- Rejected: it would force a choice between giving CI a per-project secret (reintroducing per-repo setup) or giving every PR environment org-wide provisioning power (a leaked preview credential could then affect every project, not just its own).

### Option B: Make `dev_environments.owner_id` nullable for CI-provisioned rows
- Pros: no synthetic user row; "no owner" is representationally explicit.
- Rejected: every existing consumer of `owner_id` (CASL subject tagging, `list`'s own-vs-all split, revoke's audit trail) would need a null-aware branch for a case a single sentinel row already handles, and a resolvable PR-author owner is usually available anyway — the sentinel is the exception path, not the common one.

### Option C: Restructure `index.ts` to dynamic-import everything after an async preflight step
- Pros: one process, one boot sequence, no separate `.env.runtime` file to reason about.
- Rejected: `env.ts` is imported (transitively, eagerly) by roughly 19 files across the codebase; converting all of them to dynamic imports to open one `await` window before the first import touches `env.ts` is a large, invasive refactor for a need that a two-line `package.json` script change already solves.

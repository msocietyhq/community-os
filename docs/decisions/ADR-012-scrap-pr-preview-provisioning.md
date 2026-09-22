# ADR-012: Scrap PR Preview Provisioning Entirely

**Status**: accepted
**Date**: 2026-09-22
**Deciders**: Aziz

## Context

Issue #52 asked for PR preview environments (a Neon branch + Railway environment per PR) with no per-project Neon/Railway credentials in any project's own repo. ADR-008 through ADR-011 built that out in stages: centralized provisioning, direct Railway management, usage/cost tracing foundations, and a fix moving migration execution to each calling repo. Each stage uncovered a real problem in the previous one, fixed live against production while debugging PR #66/#69/#70's own `preview / ensure` CI checks (which dogfood the same system community-os itself would offer other projects):

- A retry-forever bug in Neon branch creation (fixed).
- No branch expiration, risking orphaned Neon branches forever (fixed).
- A path bug crashing every real invocation of server-side migrations (fixed by removing that code entirely per ADR-011).
- The deeper design problem ADR-011 actually addressed: this API has no safe, generic way to run an arbitrary other project's migrations.

Chasing ADR-011's own fix (returning a PR's Neon branch connection string to the calling repo's CI via a GitHub Actions job output) hit a platform-level wall that isn't fixable in workflow YAML: GitHub Actions blocks setting any job/step output whose *value* looks like it contains a credential (a Postgres connection string with embedded basic-auth credentials matches this), independent of masking, independent of which step sets it. Confirmed by elimination across three separate attempts — removing an explicit mask, moving the secrets-touching call to a separate step — with the identical `Skip output ... since it may contain secret` warning every time.

At that point the realistic paths forward were: route the value through GitHub Actions artifacts instead of outputs, restructure the whole caller contract around a same-job composite action, or deliberately obfuscate the value to route around a GitHub security control. Weighed against the fact that only community-os itself was ever actually onboarded to this system in practice — the "any future project" generality ADR-008 was built for never had a second real user — the cost of continuing to fight platform constraints for a feature with one, self-hosted consumer wasn't worth it.

## Decision

**PR preview provisioning is removed entirely**, not paused or descoped. Specifically:

- Deleted: `.github/workflows/preview.yml`, `preview-caller.yml`; `apps/api/src/integrations/neon.ts` and `railway.ts`; `apps/api/src/routes/project-infra.ts` and its service; `apps/api/src/services/usage.service.ts`, `usage-scheduler.ts`, `audit-log.service.ts`; the `/dashboard/infra` admin page and its sidebar link.
- Removed from `dev_environments`: `pr_number`, `neon_branch_id`, `railway_environment_id`. Dropped entirely: `project_infra_configs`, `resource_usage_snapshots`, the `usage_source` enum. The `system-bootstrap` fallback-owner user (seeded in migration 0032 for PR authors with no matching community-os account) is deleted, cascading to any leftover dev_environment rows it owned.
- Removed: the `ci/ensure`/`ci/teardown` routes and their `CI_SERVICE_TOKEN` gate, `ensurePreviewEnvironment`/`teardownPreviewEnvironment`, `ProjectInfraConfig` as a CASL subject, `RAILWAY_API_TOKEN`/`NEON_API_KEY`/`NEON_ORG_ID`/`CI_SERVICE_TOKEN` from `env.ts`.
- **Kept, unaffected**: `dev_environments`/`dev_environment_vars`/`dev_environment_agent_keys`/`shared_secrets` and everything that predates this feature (agent keys, shared secrets, ordinary dev/agent environment provisioning per ADR-006/007) — none of that was PR-preview-specific, and all of it stays exactly as it was.
- Live cloud cleanup: the Neon branches and Railway environments created for PRs #66 and #70 during this work were already deleted via their own `ci/teardown` calls when those PRs were closed, before this removal — no orphaned cloud resources left behind.
- PRs #66 and #70 closed unmerged. Issue #52 closed as not planned.
- ADR-008, ADR-009, ADR-010, ADR-011 marked superseded by this one and left in place as the historical record of the reasoning at each stage — not deleted, since they're accurate accounts of what was tried and why, just no longer the current state.

## Consequences

### Positive
- Removes a live, still-broken feature (the `migrate` job's `DATABASE_URL` was never successfully delivered end-to-end) rather than leaving it half-working or silently disabled.
- Removes real complexity that had no second consumer to justify it: two integration clients, a DB schema, an admin page, a GitHub Actions contract, and four ADRs' worth of iteration, all serving one self-hosted use case.
- No more chasing GitHub Actions platform constraints that don't have a clean resolution within the shape this feature took.

### Negative
- If PR preview environments are wanted again later, this is a rebuild, not a resume — the code, schema, and workflows are gone, not archived behind a flag.
- Loses the usage/cost-tracing foundation (ADR-010) before it had a second metric source or a UI beyond the now-deleted admin page.

### Neutral
- `projects.repoUrl` and `projectsService` are otherwise untouched — only `findByRepoFullName`, which existed solely for this feature's CI lookup, was removed.

## Alternatives Considered

### Option A: fix the output-transport problem and keep going
Move to GitHub Actions artifacts, or restructure as a same-job composite action per the plan discussed before this decision.
- Pros: technically resolves the immediate blocker; the rest of the system (branch idempotency, TTL, migration-ownership split) was sound.
- Not chosen: more engineering for a feature with one actual consumer, on top of an already multi-stage rebuild history.

### Option B: keep the feature for community-os only, drop the "any future project" generality
Special-case community-os's own migration needs server-side (the very thing ADR-011 rejected for other projects) since it's the only real user anyway.
- Pros: sidesteps the credential-transport problem for the one project that matters today.
- Not chosen: re-introduces exactly the hardcoded-migrations problem ADR-011 fixed, just scoped to "works for now" — the underlying design still wouldn't generalize, and the point of building it centrally was for other projects to use it too.

### Option C (chosen): scrap it entirely
- Pros: simplest state to maintain going forward; no half-working feature left in production.
- Cons: real, already-built work is discarded rather than salvaged.

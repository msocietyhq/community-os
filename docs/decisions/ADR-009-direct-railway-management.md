# ADR-009: Manage Railway PR Environments Directly, Not Via Self-Configure

**Status**: superseded by ADR-012 — PR preview provisioning was scrapped entirely. Kept as historical record.
**Date**: 2026-09-21
**Deciders**: Aziz

## Context

ADR-008 shipped a working PR-preview design, but its Railway half required a maintainer to do two things by hand for every project, forever: mint a project bootstrap token and paste it into Railway's dashboard as a value cloned into every PR environment, so the app could call `POST /dev-environments/bootstrap` at boot and self-configure `DATABASE_URL` before `env.ts` parsed. ADR-008 accepted this as a deliberate non-goal ("Automating that requires a Railway credential we don't have a safe way to hold yet"), reasoning from Railway's **project tokens**: scoped to one *existing* environment at creation time, unable to reach a `pr-<n>` environment that doesn't exist yet.

Revisiting this: Railway's public API also issues **workspace tokens**, scoped to an entire workspace rather than one environment. A workspace token can list/create/delete environments and set variables across every project in that workspace — including an environment created after the token itself was minted. That removes the specific constraint ADR-008's non-goal was reasoning from, and opens a materially better design: this API can manage the Railway side directly, the same way it already manages Neon branches, rather than relying on Railway's native "PR Environments" dashboard feature plus an app-side self-configure step.

The goal, stated plainly by the person driving this: automate Neon and Railway away as completely as possible — link a project once, then never open either dashboard again for routine PR preview work.

## Decision

- **This API now creates, configures, and deletes the Railway PR environment itself**, via a `RAILWAY_API_TOKEN` that must be a **workspace token** (documented in `.env.example`) — never a project token, which can't do this. New `apps/api/src/integrations/railway.ts` wraps Railway's GraphQL API (`backboard.railway.com/graphql/v2`): `listProjects`/`createProject`, `listServices`, `listEnvironments`, `createEnvironment` (ephemeral, cloned from a chosen source environment, deploys held), `upsertVariable`, `deployService`, `deleteEnvironment`.
- **`ensurePreviewEnvironment`** (in `dev-environments.service.ts`) now does, in order: fork the Neon branch (unchanged from ADR-008) → create the `dev_environment` row and its `DATABASE_URL` var → if the project has a Railway project, service, *and* source environment all linked, create a matching ephemeral Railway environment, `reveal()` the environment's full var bundle (`DATABASE_URL` plus every auto-attached shared secret) and push each one via `variableUpsert`, then trigger one deploy. **`teardownPreviewEnvironment`** deletes the Railway environment alongside the Neon branch.
- **The project-bootstrap-token table, the `POST /dev-environments/bootstrap` endpoint, and `apps/api/src/scripts/preflight.ts` are deleted**, not deprecated. They existed only to get a value into a Railway-cloned environment before this API could reach that environment directly; once it can, self-configuration has nothing left to do. A project not fully linked to Railway simply doesn't get automatic variable push — its Neon branch and `DATABASE_URL` still provision automatically, and a maintainer sets vars manually via the pre-existing `PUT /dev-environments/:id/vars/:key`, same as any ordinary dev environment.
- **Neon gained the same "link, don't paste an ID" treatment**: `neonClient.listProjects`/`createProject`, and matching routes, so a maintainer picks or creates a Neon project from a dropdown instead of copying an ID out of Neon's console.
- **`project_infra_configs` grew `railwaySourceEnvironmentId`** (which environment, usually production, a new PR environment clones its service config from) alongside the existing `railwayProjectId`/`railwayServiceId`. `dev_environments` grew `railwayEnvironmentId` so teardown knows what to delete. New routes under `/api/v1/projects/:id/infra-config/{neon,railway}-projects` (list/create/link) and `/railway-{services,environments}` (list, to populate the service/source-environment pickers) back a fully dropdown-driven admin UI — no raw IDs typed anywhere.
- **`upsertProjectInfraConfigSchema`'s fields became tri-state** (`undefined` = leave as-is, `null` = clear, a string = set), because picking a different Railway project has to reset the service/source-environment fields that belonged to the old one, while linking just a Neon project must not touch Railway fields it wasn't sent.
- The reusable workflow file is renamed `preview.yml` (from `preview-db.yml`) — it now provisions the whole preview (DB + app environment), not just a database.

## Consequences

### Positive
- ADR-008's residual risk — one bootstrap-token value shared across every open PR, in principle able to request a sibling PR's bundle — is gone entirely for any project with Railway linked, because there's no cloned credential anymore.
- Once linked, a project's maintainers genuinely stop touching Neon's or Railway's own consoles for routine preview work: linking, creating, and even standing up new Neon/Railway projects all happen from this app.
- `ensurePreviewEnvironment` now pushes the *whole* var bundle (shared secrets included) into the live Railway environment, not just `DATABASE_URL` — closer to ADR-007's original "zero-touch onboarding" vision, for the PR-preview case specifically.

### Negative
- `RAILWAY_API_TOKEN` is now a materially broader credential than anything this API previously held: a workspace token can act on *every* project in that Railway workspace, not just preview environments. A leak has a bigger blast radius than the bootstrap token it replaces. Mitigated by it being this API's own env var (never in a repo, never per-project), but worth naming plainly rather than glossing over.
- The exact GraphQL field names in `railway.ts` (`environmentCreate`'s input shape, `serviceInstanceDeployV2`, etc.) are implemented against Railway's public docs, not a live introspection — this repo has no Railway credential to test against. Verify against `railway.com/graphiql` before the first real project links Railway.
- A project not fully linked to Railway (missing any of project/service/source-environment) gets no automatic variable push — this is a silent no-op inside `ensurePreviewEnvironment`, not an error, so an incompletely-configured project's PR previews will provision a Neon branch that never reaches a running app. The admin UI's "fully automated" vs. "link more to automate" banner is the only signal of this today; consider surfacing it more loudly (e.g. on the PR itself) if it causes confusion.

### Neutral
- `env.ts`'s `RAILWAY_API_TOKEN` field is unchanged (still optional) — only its *meaning* changed, from "unused, reserved" to "must be a workspace token if PR-preview Railway automation is wanted."

## Alternatives Considered

### Option A: Keep ADR-008's bootstrap-token design, just automate the Railway-dashboard paste
- Pros: no new credential type, smaller change.
- Rejected: there's nothing to automate the paste *into* without either a Railway credential broad enough to write dashboard env vars directly (at which point it may as well manage the environment itself) or continuing to ask a human to do it once per project — which is exactly the toil this revision set out to remove.

### Option B: Use a Railway project token per project instead of one workspace token
- Pros: smaller blast radius per credential — a leak only affects one project.
- Rejected: project tokens are scoped to one *existing* environment at creation time (ADR-008's original blocker), so a fresh project token still can't reach a `pr-<n>` environment that doesn't exist yet. This would need minting a new project token after every environment creation, which Railway's API doesn't support unattended, and would also mean holding N per-project credentials instead of one — more secrets to manage, not fewer.

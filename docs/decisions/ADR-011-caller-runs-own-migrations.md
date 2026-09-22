# ADR-011: The Calling Repo Runs Its Own Migrations, Not This API

**Status**: accepted
**Date**: 2026-09-22
**Deciders**: Aziz

## Context

`ensurePreviewEnvironment` (ADR-008/ADR-009) called `runMigrationsOn(databaseUrl)` right after forking a PR's Neon branch, applying this repo's own Drizzle migrations from `apps/api/drizzle` against it. The stated intent was to cover "a PR that adds migrations not yet on the parent branch" — but the implementation couldn't actually do that:

- **It never sees the PR's migrations.** `ci/ensure` is a REST call from GitHub Actions to the already-deployed production API at `api.msociety.dev`, built from whatever was last merged to `main`. The PR's own branch, with its own new migration files, never touches that running server. `runMigrationsOn` could only ever re-apply migrations already on `main` — which a branch fork already has, since forking copies the parent's schema. It was a no-op in the one case it was meant to help with.
- **It's wrong for every project other than community-os.** The migrations folder it points at (`apps/api/drizzle`) is hardcoded to this repo's own schema. Issue #52's whole point is PR preview environments for *any future onboarded project* — for any of those, this would apply community-os's own schema migrations to that project's database, which is simply incorrect and would fail or corrupt data the moment a second project actually linked its infra config.
- It also had a live, separate bug: bundled into the production build (`bun build --outdir dist`), `import.meta.dir` resolves to `apps/api/dist`, not `apps/api/src/integrations` — so `path.resolve(import.meta.dir, "../../drizzle")` pointed one directory too high and crashed with `Can't find meta/_journal.json file` on every real invocation. This is what actually surfaced the design problem: PR #66 and PR #69's own `preview / ensure` CI checks were failing on it.

The deeper reason this can't be fixed by pointing at the right folder: this API has no generic, safe way to run an arbitrary other project's migrations. Doing so would mean either hardcoding assumptions about their ORM/migration tool (breaks the moment a second project uses a different stack), or checking out and executing that project's PR code server-side — which means running untrusted, arbitrary code from any onboarded project's PR inside this platform's own trusted infrastructure. That second option was rejected outright as a code-execution risk, not weighed against convenience.

## Decision

- **`neonClient.runMigrationsOn` is deleted.** `ensurePreviewEnvironment` no longer runs any migrations. A forked branch is exactly what Neon's copy-on-write fork gives you: the parent's current schema and data, nothing more.
- **`ci/ensure`'s response now includes `databaseUrl`** — the PR's Neon branch connection string — alongside the existing `environmentId`. The calling repo's own CI, which already has the PR's checkout and knows its own migration tooling, is responsible for running its own migrations against it if the PR needs to.
- **The reusable `preview.yml` workflow exposes `database_url` as a job output** from its `ensure` job (masked in logs via `::add-mask::` before it's ever printed), so a caller repo adds one more job — `needs: preview`, running its own migration command with `DATABASE_URL: ${{ needs.preview.outputs.database_url }}` — only if it has migrations to run.
- **community-os's own `preview-caller.yml` gained exactly that job**, using its existing `db:migrate` script — dogfooding the same contract any other project would use, per ADR-009's convention.

### On exposing `databaseUrl` at all

This is a live credential leaving the platform's server boundary, which is the kind of thing ADR-008/009 were built to minimize. It's accepted here because the blast radius is narrow and the exposure isn't new:

- It's scoped to **one ephemeral branch**, not an account. It can reach nothing else in Neon or Railway — unlike `NEON_API_KEY`/`RAILWAY_API_TOKEN`, which is exactly the account-wide credential this whole redesign keeps out of every repo.
- It **expires in 30 days** regardless (see the Neon branch TTL added alongside the retry-idempotency fix in the same PR), and is deleted immediately on `ci/teardown`.
- It's **already sitting in that PR's own Railway environment variables** the moment Railway provisioning runs — visible to that project's own maintainers via the Railway dashboard regardless of whether `ci/ensure` also hands it back. Returning it to that same project's own CI run isn't a new party gaining access.

## Consequences

### Positive
- PR preview databases actually reflect what they claim to: a project's own migration step, run by that project's own tooling, produces a database whose schema matches the PR under review — including migrations that PR itself introduces.
- Removes a class of bug entirely: this API can never again silently apply the wrong project's schema to the wrong project's branch, because it doesn't apply any schema at all.
- Fixes the `_journal.json` crash as a side effect of removing the code that could hit it — no path-resolution patch needed.

### Negative
- Onboarding a new project is no longer purely "link Neon/Railway and never touch anything else": a project with its own migrations needs one extra job in its calling workflow. Projects with no schema changes to test, or that are fine with the clone-of-production schema a fork already provides, can skip it.
- `databaseUrl` now appears in a GitHub Actions job output for every onboarded repo's preview runs, which is a wider surface than "only this API's own process ever holds it" — mitigated as above, but a real change in shape.

### Neutral
- community-os itself needed no onboarding change beyond adding the same job every other project would — it's both the platform and, for this purpose, just another project being previewed.

## Alternatives Considered

### Option A (chosen): caller runs its own migrations
- Pros: correct for every project regardless of stack; no new server-side execution surface.
- Cons: onboarding gains a step; `databaseUrl` leaves the platform's process boundary (see rationale above for why this is an acceptable, narrow exposure).

### Option B: special-case community-os, skip migrations for everyone else
Keep `runMigrationsOn`, but only invoke it when the project being provisioned is community-os itself; every other project's preview is just the production clone, un-migrated.
- Pros: zero onboarding cost preserved; ships without a workflow contract change.
- Cons: leaves a documented gap instead of fixing it — a PR that adds a migration still can't get an accurate preview without a manual step; doesn't generalize as more projects onboard, which is the entire point of issue #52.
- Not chosen: defers the real fix rather than making it, for a problem that's cheap to fix correctly now while only one project is onboarded.

### Option C: this API checks out and runs the calling project's own migration command server-side
- Pros: would preserve fully zero-touch onboarding, including the migration step.
- Cons: means executing arbitrary code from any onboarded project's PR inside this platform's own trusted infrastructure — a code-execution risk on infra that holds `NEON_API_KEY`/`RAILWAY_API_TOKEN`/`CI_SERVICE_TOKEN`. Also technically heavier: needs a sandboxed runner, checkout logic, and per-project migration-framework detection.
- Rejected outright, not on convenience grounds.

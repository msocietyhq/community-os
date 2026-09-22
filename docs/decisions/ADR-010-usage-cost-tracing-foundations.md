# ADR-010: Usage and Cost Tracing Foundations for PR Previews

**Status**: superseded by ADR-012 — PR preview provisioning was scrapped entirely, taking this foundation's only consumer with it. Kept as historical record.
**Date**: 2026-09-21
**Deciders**: Aziz

## Context

Issue #52's provisioning work (ADR-008/009) gave admins/maintainers a way to *create* PR preview infrastructure automatically, but no way to *see* it afterward: `audit_log` has been written to since ADR-006 (every reveal, create, revoke, rotate) but had no read endpoint anywhere in the codebase — a query against a real deployment's `audit_log` table confirmed rows exist with no route ever serving them back. Separately, there was no visibility into what a project's PR previews actually cost or consume: `provisionedResources.monthlyCostEstimate` exists but belongs to the unrelated ADR-006 member-project-provisioning flow and is itself unpopulated (`infra.ts`'s `/provision` route is still a stub).

This ADR scopes deliberately to **foundations** — the two visibility gaps above — not a full billing dashboard, and explicitly skips a third, separately-tracked gap (letting a maintainer onboard an arbitrary existing member into a project's `dev_environments` with revocable, mixed shared/generated var access): that needs its own design pass on the `create` route and ownership model, and doing it alongside this would conflate two unrelated changes.

Before building, this checked what Neon and Railway's public APIs actually expose:
- **Neon** has a real, documented per-branch consumption endpoint (`GET /consumption_history/v2/branches`), returning `compute_unit_seconds` (the actual compute-cost driver) and storage bytes-month, attributable to a specific branch — i.e., a specific PR. It needs an org ID and a paid usage-based plan; it doesn't compute a dollar figure, just raw units.
- **Railway**'s public GraphQL API has no discovered equivalent — its cookbook and reference docs cover project/service/environment/variable/deployment management, but nothing resembling a per-environment usage or cost query. Its billing is real (per-second vCPU/memory/egress/storage) but not exposed as a queryable metric per environment via the API, only as an account-level dashboard page for humans.

Given that asymmetry, this ADR builds real per-branch numbers where they exist (Neon) and doesn't fabricate an estimate where they don't (Railway) — and doesn't attempt any dollar conversion, since actual pricing depends on account-specific plan tiers this API has no reliable way to look up.

## Decision

- **A new `resource_usage_snapshots` table** — append-only, one row per (project, environment, metric, period): `source` (currently only `"neon"`), `metricName`, `value` (the provider's own unit, `numeric`), `periodStart`/`periodEnd`, `fetchedAt`. `devEnvironmentId` is nullable with `ON DELETE SET NULL` — a since-deleted PR environment's historical usage stays queryable, just no longer joinable to a live row.
- **`neonClient.getBranchConsumption`** wraps the endpoint above. It degrades gracefully (returns `[]`, logs a warning) rather than throwing when the account isn't on a plan that exposes it — this is a foundation feature, not something that should break provisioning for accounts without it. Requires a new `NEON_ORG_ID` env var (optional, like the other infra credentials).
- **`usage.service.ts`**: `collectNeonUsageForProject` pulls and stores consumption for every environment with a `neonBranchId`, given a time window; `getUsageSummary` rolls stored snapshots up per environment — summing the flow metric (`compute_unit_seconds`) across the window, taking the latest value for the point-in-time storage metrics.
- **A daily cron** (`usage-scheduler.ts`, following the existing `digest-scheduler.ts` croner pattern) collects usage for every project with a Neon project linked. One project's failure (e.g. not on a usage-based plan) doesn't block the others.
- **`auditLogService.listForProjectInfra`** is the first reader `audit_log` has ever had: recent entries scoped to one project's `project_infra_config` row and all its `dev_environments`. Deliberately narrow — a general-purpose audit browser is future scope if another entity type needs the same treatment.
- **New routes** under `/api/v1/projects/:id/infra-config`: `GET /usage` (read-gated, any project member), `POST /usage/refresh` (update-gated, triggers an on-demand collection instead of waiting for the nightly cron), `GET /activity` (read-gated).
- **Admin UI** gained two new sections per project: "Usage (Neon)" (per-PR compute/storage, raw units, a manual refresh button) and "Recent Activity" (the audit trail, resolving `performedBy` against the project's own member list where possible, with `system-bootstrap` shown as "community-os (automated)").

## Consequences

### Positive
- `audit_log` finally has a reader — every provisioning/reveal/revoke action taken through this feature is now visible to the people who'd want to see it, not just written to a table nobody queries.
- Real, provider-sourced numbers (not estimates) for the cost driver that matters most on Neon's side (compute-seconds), attributable per PR.
- The append-only snapshot design means historical usage survives environment teardown — a maintainer can still see what a closed PR cost.

### Negative
- No cost visibility into Railway at all — this ADR does not close that gap because no API to close it with was found. If Railway later exposes one, `usage_source` is designed to grow a second value rather than needing a redesign.
- No dollar figures anywhere in this feature. Converting `compute_unit_seconds` to a real cost requires knowing the account's specific Neon plan/pricing tier, which isn't retrievable via API in a way this ADR verified — showing a wrong estimate seemed worse than showing raw units with an honest caveat.
- The consumption endpoint requires a paid usage-based Neon plan; on a free-tier or legacy-pricing account, `getUsageSummary` will simply return nothing, and the UI's empty state is the only signal of that (it doesn't distinguish "no plan support" from "no data collected yet").
- Like the Neon and Railway integration clients before it, `getBranchConsumption`'s exact response shape is implemented against Neon's published docs, not exercised against a live consumption-metrics-enabled project in this environment.

### Neutral
- Explicitly out of scope: maintainer-onboards-any-member with revocable env var access. Tracked separately; not touched here.

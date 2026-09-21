# ADR-007: Dev/Agent Environment Provisioning for Internal Projects

**Status**: accepted
**Date**: 2026-09-21
**Deciders**: Aziz

## Context

ADR-006 covers secrets generated *for* endorsed member projects during infra provisioning. This is a different problem: contributors (human and AI agents) working *on* an MSOCIETY-endorsed project — community-os itself included, since `projects.isEndorsed` already models "MSOCIETY-endorsed," not just member showcase projects — need a working set of env vars. Some of those are generated per-contributor (a Neon branch's `DATABASE_URL`), some are one shared value the whole project uses (a staging `ANTHROPIC_API_KEY`).

Without this, onboarding a new contributor or spinning up an agent session means an admin manually handing over credentials — exactly the toil this is meant to remove. The existing role model (`member`/`admin`/`superadmin` globally, `owner`/`contributor` per project) has no tier that distinguishes "can manage this project's shared secrets and other people's environments" from "can work on this project."

## Decision

- Add `maintainer` to `project_member_role` (`owner`/`maintainer`/`contributor`). Maintainers and owners manage the project's shared secrets and any environment in it; a contributor manages only their own.
- `dev_environments` — a grant, one per contributor (or per agent session, via an agent key — see below) per project.
- `shared_secrets` — project-wide values, created/rotated once by a maintainer. On environment creation, every one of the project's shared secrets is auto-attached by reference (`dev_environment_vars.shared_secret_id`), never copied — this is what makes onboarding self-serve. A generated value (per-environment, e.g. a Neon branch's connection string) gets its own ciphertext in the same table instead.
- `dev_environment_agent_keys` — a short-lived bearer token (hashed at rest, shown once, mandatory expiry, default 1h/cap 24h) a maintainer *or the environment's own owner* can mint against one environment, so an agent session (which has no Better Auth session of its own) can redeem that environment's bundle without a human in the loop each time. Minting your own key needs no elevated permission: it only unlocks access the owner already has, on an auto-expiring credential — gating it behind "maintainer" would just reintroduce the manual bottleneck this exists to remove. Redemption (`POST /dev-environments/agent-keys/redeem`) is deliberately outside `authMiddleware`; the token itself is the credential, checked in the service.
- Same AES-256-GCM primitive as ADR-006 (`lib/crypto.ts`), same reveal-is-always-audited discipline.

**Out of scope this pass**: live Neon branch provisioning. A generated var like `DATABASE_URL` is set manually via `PUT /dev-environments/:id/vars/:key` until that's wired up — a follow-up, not a gap in this design.

## Consequences

### Positive
- A new contributor gets a working environment with the project's current staging keys with zero maintainer involvement.
- Agent sessions get scoped, auto-expiring credentials instead of a human copy-pasting long-lived secrets into a sandbox.
- Reuses ADR-006's encryption and audit discipline rather than inventing a second secrets story.

### Negative
- CASL's global `defineAbilityFor` doesn't know about per-project roles, so authorization for these subjects always needs an async DB-backed resolver (`checkPermissionOn`, now widened to see `body`/`query` for create-time and list-time checks) — never the cheap subject-type-only check alone.
- Neon branch creation being stubbed means the "generated secret" path isn't actually automatic yet for the one var that matters most (`DATABASE_URL`).

### Neutral
- `checkPermissionOn`'s ctx type grew `body`/`query` — a small, backward-compatible widening used by every route in this feature that needs to resolve a not-yet-existing resource's parent project.

## Alternatives Considered

### Option A: Gate agent-key minting behind maintainer role
- Pros: one more approval checkpoint before an agent gets credentials.
- Rejected: an agent key only unlocks the environment its owner can already reveal directly. Requiring maintainer sign-off on an ephemeral, auto-expiring version of access someone already has adds process without adding security, and reintroduces the per-contributor admin bottleneck this feature exists to remove.

### Option B: A new `dev_projects` concept, separate from `projects`
- Pros: keeps "codebases contributors work on" conceptually distinct from "community-showcased member projects."
- Rejected: `projects.isEndorsed` already exists for exactly "MSOCIETY-endorsed," and community-os is naturally just another endorsed project. A parallel table would duplicate membership/endorsement machinery for no real benefit.

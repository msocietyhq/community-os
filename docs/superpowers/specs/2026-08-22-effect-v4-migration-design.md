# Effect v4 Migration — Design

**Status**: approved, not started
**Date**: 2026-08-22
**Author**: Aziz
**Scope**: Phase 1 only — `apps/api/src/services/` (24 source files), `apps/api/src/bot/` (46 source files), and the parts of `apps/api/src/lib/` they depend on (`retry.ts`, `errors.ts`). **70 source files**, plus all 22 test files ported to a new runner in step 0. Later phases are sketched but out of scope for the implementation plan that follows this spec.

---

## Context

`apps/api` is ~22.8k LOC across 158 TypeScript files. Three problems motivated this work, all confirmed by reading the code:

1. **Failure modes are invisible.** There are 61 `try`/`catch` blocks and a single `AppError` class carrying a stringly-typed `code`. Failures that should be loud are silently swallowed by fire-and-forget `.catch(console.error)` — audit-log writes (`routes/members.ts:42`, `:131`, `:164`, `:203`), Telegram ban/unban calls (`services/members.service.ts:266`, `:282`), and every background task in `index.ts`. Nothing in a function's type says whether it can fail, or how.

2. **Concurrency and retries are hand-rolled and inconsistent.** `lib/retry.ts` is ~115 lines implementing exponential backoff, full jitter, `Retry-After` parsing, and a transient-error regex. It has to inject `sleep` and `random` as parameters purely so tests don't wait on real time. Meanwhile `Promise.all` appears in 15 files with no concurrency bound — `tech-news.service.ts` fans out to Hacker News, Exa, and GitHub with `AbortSignal.timeout` and per-item `try`/`catch` that discards failures.

3. **Nothing is injectable, so nothing with I/O is tested.** Services import the `db` singleton directly from `db/index.ts`. `members.service.ts:6` imports the grammY `bot` singleton — a service reaching into the presentation layer, inverting the boundary rule that ADR-005 established. All 22 test files target *extracted pure helpers*; not one exercises a service that touches the database, because there is no seam to stub.

Effect addresses all three directly. This spec defines how far it reaches, what the boundaries are, and in what order the work happens.

---

## Decisions

These were settled during design and are inputs to the plan, not open questions.

| Decision | Choice |
|---|---|
| Effect version | **v4**, pinned exactly at `4.0.0-rc.111` |
| Boundary (Phase 1) | `services/` and `bot/` internals only. Elysia, Zod contract validators, `packages/shared`, Eden Treaty, and `apps/web` are untouched |
| DI depth | **Full DI immediately.** A migrated file gets `Context.Service` + `Layer`. No file is migrated twice |
| Test runner | **Migrate all 22 files** to `vitest` + `@effect/vitest` |
| AI | **`effect/unstable/ai`** + `@effect/ai-anthropic`, replacing the Vercel AI SDK |
| Unstable modules | Acceptable. Pin exact versions; upgrades are deliberate, test-guarded work items |
| Effect docs for agents | Point `CLAUDE.md` at `node_modules/effect/ai-docs/`. **No git submodule** |

### Why v4 and not v3

v4 collapses the ecosystem into the single `effect` package via subpaths (`effect/unstable/http`, `effect/unstable/sql`, `effect/unstable/ai`, `effect/testing`). The v3-era packages `@effect/platform`, `@effect/sql`, `@effect/schema` do not apply — `@effect/schema` is deprecated outright, having been merged into `effect`.

v4 is at `4.0.0-rc.111` (npm `latest` is still `3.22.1`). Adopting v3 now would mean doing this migration twice, since the v4 API differs substantially.

**Verified v4 API differences from v3** (read from the installed source, not from memory):

- `Either` → `Result`
- `Context.Tag` → `Context.Service<Self, Shape>()("id")`, with a static `layer`
- `Data.TaggedError` → `Schema.TaggedError<E>()("Tag", { fields })`
- `Schedule.both` / `Schedule.intersect` removed; capping is `Schedule.min([...])` composed with `Schedule.while(({ attempt }) => ...)`
- `Effect.fn("name")` is the idiomatic form for named, traced functions
- `Effect.forkDaemon` → `Effect.forkDetach` (fork variants are now `forkChild`, `forkDetach`, `forkIn`, `forkScoped`)
- `Schema.decodeUnknown` → `Schema.decodeUnknownEffect` (the `decode*` family is split by output: `*Effect`, `*Exit`, `*Option`, `*Result`, `*Promise`, `*Sync`)
- `Layer.Layer.Success<T>` → `Layer.Success<T>` (the nested namespace is flattened)

Every rename above was caught by `tsgo` before runtime, which is a useful property for the upgrade policy below: v4 API churn surfaces as type errors, not as production surprises.

### Why no submodule

The `effect` package already ships `CLAUDE.md`, `AGENTS.md`, and `ai-docs/` — 356K across 20 topic directories of runnable `.ts` examples covering services, layers, schedules, testing, sql, http, and ai — plus the full 18M `src/`. Its own `CLAUDE.md` states:

> "use this documentation and the Effect source code **available in your environment**. Avoid unrelated copies of Effect or external documentation, as they may be outdated or incorrect."

A submodule pinned to a different commit than the installed RC is precisely the "unrelated copy" that warns against, and v4 moves fast (rc.108 → rc.111 within one release window). A `CLAUDE.md` pointer to `node_modules/effect/ai-docs/` is always version-matched and costs nothing to maintain.

---

## Feasibility spike (already done)

A throwaway spike in the scratchpad validated the Phase 1 pattern set against `effect@4.0.0-rc.111`, type-checked with **this repo's own `tsgo`** (`@typescript/native-preview`), under `exactOptionalPropertyTypes: true`.

**Result: clean, in 0.73s.** `Context.Service` DI, `Schema.TaggedError`, `Effect.fn`, `Schedule`-based retry, bounded `Effect.forEach`, and `Effect.catchTags` all compile. tsgo + Effect v4 is not a risk.

**The seam mechanically forces exhaustive error handling.** With the route seam typed to require `E = never`, deleting one arm from a route's error mapping fails compilation with:

```
error TS2379: Type 'DbError' is not assignable to type 'never'.
```

This is the mechanism that delivers goal (1). It is compiler-enforced, not a convention that erodes. Note the corollary: Effect does *not* force error handling on its own — errors propagate silently up the `E` channel unless something demands `never`. The seam's type signature is what creates the pressure, so it must not be weakened.

### Bun runtime verification — PASSED

A second spike (`scratchpad/tsgo-effect4/src/bun-check.ts`) executed **11 isolated runtime checks** against `effect@4.0.0-rc.111` on **Bun 1.3.6**, deliberately targeting the Bun-specific risk areas rather than merely importing the library.

**Result: 11/11 passed.**

| Check | Bun-specific risk being probed | Result |
|---|---|---|
| `runPromise` + `Effect.gen` | baseline | pass |
| `Context.Service` + `Layer` | DI resolution, layer memoization | pass — state correctly shared |
| `Effect.fn` | stack-trace capture (`Error.prepareStackTrace`) | pass |
| `withSpan` across `sleep` | async context propagation (`AsyncLocalStorage`) | pass — context survived 2 async boundaries |
| `Schedule` retry, real clock | timers actually firing and delaying | pass — 3 attempts, real 130ms backoff |
| `Effect.forEach` `{ concurrency: 4 }` | scheduler enforces the cap | pass — peak in-flight exactly 4/4 |
| `Schema.TaggedError` + `catchTags` | tag dispatch at runtime | pass |
| `timeout` + `onInterrupt` | cooperative cancellation | pass — interrupt handler ran |
| `Effect.forkDetach` + `Fiber.join` | supervised background fibers | pass |
| `Scope` finalizers | resource release ordering | pass — acquire → release |
| `Schema.decodeUnknownEffect` | decode + rejection of invalid input | pass |

The checks assert on *observed behavior*, not just absence of exceptions: the retry check fails if no real delay occurs, and the concurrency check fails if the cap is breached **or** if no actual parallelism is observed.

**Two further v4 renames were discovered by this spike** (both caught by `tsgo` before running):

- `Effect.forkDaemon` → **`Effect.forkDetach`**
- `Schema.decodeUnknown` → **`Schema.decodeUnknownEffect`**

Bun compatibility is therefore no longer a risk in this plan.

---

## Architecture

Three concentric rings.

```
┌─ Edge (UNCHANGED) ──────────────────────────────────────┐
│  Elysia · Zod contract models · Eden Treaty · apps/web  │
│  Better Auth · grammY handler signatures · OpenAPI      │
│  ┌─ Seam (NEW, small) ─────────────────────────────┐    │
│  │  ManagedRuntime · runRoute() · runHandler()     │    │
│  │  tagged-error → HTTP status mapping             │    │
│  │  ┌─ Core (EFFECT) ───────────────────────────┐  │    │
│  │  │  services/ · bot/lib · bot/ai             │  │    │
│  │  │  Effect<A, TaggedError, Deps>             │  │    │
│  │  └───────────────────────────────────────────┘  │    │
│  └─────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────┘
```

### The load-bearing invariant

The seam returns **the same plain objects route handlers return today**. Therefore `typeof app` is unchanged, therefore Eden Treaty's inference into `apps/web` is unaffected.

Phase 1 *cannot* break the web app. That is a structural property of the boundary, not a matter of care during implementation.

The same applies at the Telegram edge: grammY handlers keep their `(ctx) => Promise<void>` signature; Effect lives inside them.

---

## Components

### 1. Error taxonomy — `apps/api/src/errors/`

Replace the single `AppError` class with `Schema.TaggedError` classes in three groups:

- **Infrastructure**: `DbError`, `HttpError`, `ProviderError`
- **Domain**: `MemberNotFound`, `InsufficientRole`, `AlreadyBanned`, `SelfTargeted`, …
- **Validation**: decode failures from `Schema`

Errors carry structured fields rather than a formatted message. `ProviderError` carries `{ status?, retryable }` so retry policy is a property of the error, not a regex over its message string — which is what `isRetryableError` in `lib/retry.ts` does today.

**Services never reference HTTP.** Status mapping lives exclusively in the seam. This preserves the "service layer is framework-agnostic" rule from `CLAUDE.md`, which the current `AppError.statusCode` field quietly violates.

### 2. Layers — `apps/api/src/layers/`

| Layer | Replaces | Notes |
|---|---|---|
| `Database` | the `db` singleton import | Drizzle boundary wrapper — see below |
| `Telegram` | `bot` import in `members.service.ts:6` | Removes the service → presentation-layer cycle, restoring ADR-005's boundary |
| `AI` | Vercel AI SDK calls | `@effect/ai-anthropic` |
| `Embeddings` | `voyageai` client | Custom `EmbeddingModel.make` |
| `Http` | raw `fetch` + `AbortSignal.timeout` | tech-news, Exa, GitHub, HN |

`Clock` and `Random` come from Effect for free. This deletes the injected `sleep` and `random` parameters from `lib/retry.ts`, which exist only for testability.

**`Database` granularity — approved decision.** Do *not* re-implement Drizzle's query surface as service methods; that surface is enormous and the wrapper would be pure overhead. Instead:

- `Database` exposes the Drizzle client plus `use` / `transaction` helpers that map rejections to `DbError`.
- Each *domain* service (`MembersService`, `EventsService`, …) becomes its own `Context.Service` with a `layer` depending on `Database`.

DI therefore lands at the **service** boundary, which is where tests want to stub. Stubbing individual queries was never the goal.

### 3. Seam — `apps/api/src/runtime/`

- A `ManagedRuntime` built once from `AppLayer`. v4 ships an exact reference implementation at `ai-docs/src/04_integration/10_managed-runtime.ts`.
- `runRoute(effect)` — typed to demand `E = never`. The compiler rejects any route with an unmapped domain error.
- `runHandler(effect)` — the grammY edge. Logs defects rather than throwing into grammY's error handler.
- Today's `createAuditEntry(...).catch(console.error)` becomes a supervised `Effect.forkDetach` with real logging, so a failed audit write is observable instead of a console line in production. (Verified running under Bun — see the runtime spike.)

### 4. Testing

Migrate all 22 `bun:test` files to `vitest` + `@effect/vitest` (`4.0.0-rc.111`, version-locked to `effect`). The imports are near-identical, so the port is mostly mechanical.

Gains:

- `it.effect`, `it.layer`, `it.effect.prop` for property tests
- `TestClock` from `effect/testing` — `retry.test.ts` drops its injected `sleep`/`random` entirely
- **New capability**: testing a service against a stub `Database` layer, which is impossible today

The migrated suite is also the guard for RC upgrades, which is why it lands in step 0 rather than later.

### 5. AI — `effect/unstable/ai`

Current usage, measured: **47** `tool(`, **18** `generateObject`, **16** `generateText`, **16** `stepCountIs`, **zero** streaming. Embeddings go through the `voyageai` client directly, not the AI SDK.

| Today | Effect v4 | Assessment |
|---|---|---|
| `tool()` × 47 | `Tool.make` + `Toolkit` | Upgrade — adds a typed `success` schema and a `failureMode` policy |
| `generateObject` × 18 (Zod) | `LanguageModel.generateObject` (Schema) | Straightforward; these schemas are service-local |
| `generateText` × 16 | `LanguageModel.generateText` | Direct, plus a `concurrency` option for tool resolution |
| `voyageai` + hand-rolled `BATCH_SIZE = 128` | `EmbeddingModel.make` | Upgrade — a built-in request resolver batches concurrent `embed` calls into one `embedMany` |
| `stepCountIs()` × 16 | *nothing* | **Gap** |

**The agentic-loop gap.** `LanguageModel.generateText` performs a *single* tool round-trip: call the model, resolve tool calls, then make one follow-up call with `toolChoice: "none"`. There is no `maxSteps` equivalent. The 16 multi-step loops must be hand-written as recursive Effects using `disableToolCallResolution: true`.

This is the single largest line item in the AI workstream and should be scoped accordingly. It is not purely a cost — an explicit loop gains interruption, per-step spans, bounded tool concurrency, and typed errors — but it is new code that does not exist today.

### 6. The two Zod populations

These are distinct and must not be conflated:

| Population | Files | Feeds | Phase |
|---|---|---|---|
| **API contract** | `packages/shared/src/validators/*` (11 files) | Elysia `.model()` → OpenAPI → Eden Treaty → `apps/web` | **Phase 2** — out of scope |
| **AI structured output** | 12 files in `services/` + `bot/ai/` | `generateObject` only, internal | **Phase 1** — in scope |

Migrating the AI schemas to `Schema` is contained within Phase 1's boundary and does not touch the web app. Migrating the contract validators breaks API and web simultaneously and needs its own spec.

---

## Sequencing

| Step | Scope | Rationale |
|---|---|---|
| **0** | Deps pinned · vitest + `@effect/vitest` migration · `errors/` · `runtime/` seam · `Database` layer | No behavior change. The test suite must exist before it can guard anything. (Bun runtime already verified — no longer a gate) |
| **1** | **Pilot: `members`** — `services/members.service.ts` + `routes/members.ts` | Small, but exercises DB, Telegram, the seam, and audit-fork. Ships |
| **2** | `lib/retry.ts` → `Schedule` · `Http` layer · `tech-news.service.ts` | The resilience payoff, with no model changes in flight |
| **3** | **AI foundation**: `AI` layer + Voyage `EmbeddingModel` · `embeddings.service.ts` · `ai.service.ts` | Must land before `bot/ai` |
| **4** | Remaining 20 services | Mechanical by this point |
| **5** | `bot/ai`: 47 tools → `Toolkit` · **hand-written agent loops** · `agents/*` | Largest and riskiest; goes last, on well-trodden ground |
| **6** | `bot/handlers` · `index.ts` backfills → supervised fibers | Cleanup |

### Coexistence rule

**A file is either fully Effect or fully not.** No half-migrated files. Non-Effect callers reach Effect code through the seam helpers. This is the rule that keeps a long two-idiom window from rotting into permanent inconsistency.

---

## Later phases (sketched, not scoped)

Not blocked on v4 stabilising — unstable modules are acceptable per the version-pinning policy. The blockers below are concrete and technical.

- **Phase 2 — Zod → `effect/Schema` in `packages/shared`.** Not blocked, but breaks API and web in one shot. Needs its own spec covering Elysia's validator integration, OpenAPI generation, and Eden Treaty inference.
- **Phase 3a — Elysia → `effect/unstable/httpapi`.** Available. A large rewrite that supersedes ADR-002 and ADR-003.
- **Phase 3b — Drizzle → `effect/unstable/sql`.** **Blocked outright.** v4 ships no Drizzle integration, and v3's `@effect/sql-drizzle` has no v4 counterpart. This is a verified fact, not a judgment call.
- **Phase 4 — `apps/web`.** Optional. Bundle size becomes a real consideration on the client.

---

## Version pinning policy

Pin exactly, in lockstep — all four are released together at the same version:

- `effect` — `4.0.0-rc.111`
- `@effect/ai-anthropic` — `4.0.0-rc.111`
- `@effect/vitest` — `4.0.0-rc.111`
- `bun.lock` committed

Upgrades are deliberate work items, never incidental. Each upgrade runs the full migrated test suite and reviews the changelog for renames of the kind already seen between v3 and v4 (`Either`→`Result`, `Schedule.both` removal). Do not use range specifiers on these packages.

---

## Risks

| Risk | Severity | Mitigation |
|---|---|---|
| ~~Bun runtime incompatibility~~ | **Retired** | Verified 11/11 on Bun 1.3.6, including async context, stack-trace capture, real-clock scheduling, and finalizers |
| Agentic-loop rewrite (16 sites) is larger than estimated | High | Scoped last, at step 5, after the team is fluent. Prototype one loop before committing to all 16 |
| RC churn between rc.111 and stable | Medium | Exact pins; migrated test suite as the guard; deliberate upgrades |
| `bot/ai/agent.ts` calls `yoga.handle()` in-process | Medium | GraphQL resolvers need the seam too. Folded into step 5 |
| Learning curve across 70 source files | Medium | Pilot first; `ai-docs` pointer in `CLAUDE.md`; one-file-one-idiom rule |
| Two idioms coexisting for a long window | Low | Coexistence rule + step ordering that always leaves the app shippable |

---

## Out of scope

- `apps/web` — no changes in Phase 1
- `packages/shared` contract validators — Phase 2
- Better Auth and `.mount(auth.handler)` — untouched
- Drizzle schema definitions and migrations — untouched
- Elysia routing, `.model()` registrations, OpenAPI config — untouched

---

## Success criteria

1. `bun type-check` and the migrated `vitest` suite pass at every step boundary.
2. Eden Treaty types in `apps/web` are unchanged — verified by `apps/web` type-checking without modification.
3. At least one service has a test that runs against a stub `Database` layer — a capability that does not exist today.
4. `lib/retry.ts` is deleted, replaced by a `Schedule`.
5. No `.catch(console.error)` remains in migrated files; every previously-swallowed failure is either handled or logged through a supervised fiber.
6. Every route in a migrated file has an exhaustive, compiler-checked error mapping.

# Effect v4 Migration — Phase 6: Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: `superpowers:subagent-driven-development`. Steps use checkbox (`- [ ]`) syntax.
>
> **MANDATORY PREAMBLE:** Read `node_modules/effect/CLAUDE.md` and `node_modules/effect/ai-docs/src/01_effect/06_running/` before starting.

**Goal:** Convert the startup backfills in `index.ts` to supervised fibers, remove the last silent failure paths, and record the migration's outcome.

**Prerequisite:** Phases 1–5 complete.

---

### Task 6.1: Supervised startup tasks

**Files:**
- Modify: `apps/api/src/index.ts`

Today this file launches seven background tasks as detached promises, each ending in `.catch((err) => console.error(...))`. A failure is a console line and nothing more. There is also a deliberate production-only chain (`backfillMemories → calibrateRecall → aiProfileService.backfillMissing`) whose ordering must be preserved — each step reads what the previous wrote.

- [ ] **Step 1: Read the file and record every task and its ordering constraint**

Note especially:
- The `NODE_ENV === "production"` guard around the memory/calibration/profile chain — the first two cost money and `bun dev` runs with `--watch`.
- `calibrateRecall()` runs outside production too, because it is read-only.

Both behaviours must survive.

- [ ] **Step 2: Convert to supervised fibers**

```ts
import { Effect } from "effect"
import { runtime, runBackground } from "./runtime"

/** Independent, order-free startup work. */
const independentStartup = Effect.forEach(
  [
    { name: "member-backfill", effect: backfillMissingMembers },
    { name: "embedding-backfill", effect: backfillMissingEmbeddings },
    { name: "photo-backfill", effect: backfillInlinePhotos },
    { name: "reputation-recalc", effect: recalculateAllScores },
  ],
  ({ name, effect }) =>
    effect.pipe(
      Effect.catchCause((cause) => Effect.logError(`${name} failed`, cause)),
      Effect.withSpan(`startup.${name}`),
    ),
  { concurrency: 2, discard: true },
)

/**
 * Ordered chain — each step reads what the previous wrote. Production only:
 * the first two spend money and dev runs with --watch.
 */
const orderedStartup = Effect.gen(function*() {
  if (process.env.NODE_ENV === "production") {
    yield* backfillMemories
    yield* calibrateRecall
    yield* backfillMissingProfiles
  } else {
    yield* Effect.logInfo(
      "Memory + AI profile backfill skipped (NODE_ENV is not production)",
    )
    // Read-only, so it still runs outside production.
    yield* calibrateRecall
  }
}).pipe(Effect.catchCause((cause) => Effect.logError("startup chain failed", cause)))

runBackground(independentStartup)
runBackground(orderedStartup)
```

- [ ] **Step 3: Convert shutdown to release the runtime**

The `SIGTERM`/`SIGINT` handler must dispose the `ManagedRuntime` so the `Database` layer's finalizer closes the postgres pool:

```ts
import { disposeRuntime } from "./runtime"

const shutdown = async () => {
  console.log("Shutting down...")
  await shutdownBot()
  await disposeRuntime()   // closes the postgres pool via the layer's finalizer
  app.stop()
  process.exit(0)
}
```

`disposeRuntime` was defined in Phase 1 task 1.7 and wraps `runtime.dispose()`,
which is verified to exist on `ManagedRuntime` in `4.0.0-rc.111`.

- [ ] **Step 4: Verify startup still compiles**

Run: `bun run --cwd apps/api build`
Expected: build succeeds.

**Do not start the server to check.** `apps/api/.env` points `DATABASE_URL` at
production Neon, and booting would run the startup backfills against live data.
Compilation plus the stub-level tests are the verification for this task.

- [ ] **Step 5: Run the gate**

Run: `bun run test && bun run type-check && bun lint`
Expected: green.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/index.ts
git commit -m "refactor: supervise startup backfills as Effect fibers

Failures were console.error lines on detached promises. They are now
logged with spans, and the runtime is disposed on shutdown so the
postgres pool closes cleanly."
```

---

### Task 6.2: Eliminate remaining silent failures

- [ ] **Step 1: Find every remaining swallow**

```bash
rg -n "catch\(console\.error\)|catch \(.*\) \{\s*\}|\.catch\(\(\) => \{\}\)" apps/api/src
```

- [ ] **Step 2: Convert each one**

Every hit becomes either a mapped typed error or `runBackground(...)` with an `Effect.logError`. If a failure genuinely should be ignored, make that explicit and say why:

```ts
Effect.catchCause((cause) =>
  Effect.logDebug("presence ping failed; safe to ignore", cause))
```

- [ ] **Step 3: Verify none remain**

Run: `rg -c "catch\(console\.error\)" apps/api/src | wc -l`
Expected: `0`

- [ ] **Step 4: Run the gate and commit**

```bash
git add apps/api/src
git commit -m "refactor: remove remaining silent failure paths

Fulfils success criterion 5 of the migration spec: no swallowed errors
in migrated files."
```

---

### Task 6.3: Verify every spec success criterion

Check each criterion from `docs/superpowers/specs/2026-08-22-effect-v4-migration-design.md`.

- [ ] **Step 1: Run the checks**

```bash
echo "1. gate green:";        bun run test && bun run type-check && bun lint
echo "2. web unmodified:";    git diff --name-only main -- apps/web | wc -l          # expect 0
echo "3. stub-db tests:";     rg -l "Layer.succeed(Database)" apps/api/src | wc -l   # expect >= 3
echo "4. retry.ts gone:";     test ! -f apps/api/src/lib/retry.ts && echo OK
echo "5. no silent catches:"; rg -c "catch\(console\.error\)" apps/api/src | wc -l   # expect 0
echo "6. no db singleton:";   rg -l 'from "\.\./db"' apps/api/src/services | wc -l   # expect 0
echo "7. validators clean:";  git diff --name-only main -- packages/shared/src/validators | wc -l  # expect 0
```

- [ ] **Step 2: Record results in `STATE.md`**

Record each criterion as `PASS` or `FAIL` with its measured value. A `FAIL` is not a halt — record it and continue; it becomes follow-up work.

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/plans/STATE.md
git commit -m "chore: record Effect migration success criteria results"
```

---

### Task 6.4: Write the ADR

**Files:**
- Create: `docs/decisions/ADR-006-effect-v4-adoption.md`

- [ ] **Step 1: Write it**

Follow the house style of `docs/decisions/ADR-005-merge-bot-into-api.md`: `Status` / `Date` / `Deciders`, then Context, Decision, Consequences (Positive / Negative / Neutral), Alternatives Considered.

Content, drawn from the spec and from what execution actually revealed:

- **Context** — the three problems: invisible failure modes (61 `try`/`catch`, silent `.catch(console.error)`), hand-rolled retry and unbounded `Promise.all`, and untestable services caused by singleton imports.
- **Decision** — Effect v4 pinned exactly; Phase 1 boundary at `services/` and `bot/`; Elysia, Zod contract validators, and `apps/web` untouched; DI at the domain-service boundary with `Database` wrapping the Drizzle boundary rather than its query surface.
- **Consequences (Negative)** — pinned to an RC, so upgrades are deliberate work; `effect/unstable/*` for AI; the agentic loop is hand-maintained code that the AI SDK previously provided; a learning curve.
- **Alternatives** — Effect v3 (rejected: would mean migrating twice); wrapping only the risky edges (rejected: leaves two idioms permanently and gives little DI benefit); full rewrite to `unstable/httpapi` + `unstable/sql` (rejected: no Drizzle integration exists in v4).

Record the actual outcome, not the prediction — if a phase was harder than planned, say so.

- [ ] **Step 2: Commit**

```bash
git add docs/decisions/ADR-006-effect-v4-adoption.md
git commit -m "docs: record ADR-006 on Effect v4 adoption"
```

---

### Task 6.5: Final gate

- [ ] **Step 1: Run everything**

Run: `bun run test && bun run type-check && bun lint && bun run build`
Expected: all green.

- [ ] **Step 2: Mark the migration complete**

Set `status: ALL PHASES COMPLETE` in `STATE.md` and append a summary: phases completed, tasks blocked, success criteria met, and any follow-up work.

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/plans/STATE.md
git commit -m "chore: Effect v4 migration phase 1 complete

Services and bot internals now run on Effect. Elysia, the Zod contract
validators, and apps/web are unchanged. Later phases (Zod to Schema,
Elysia to HttpApi, Drizzle to unstable/sql) remain future work; the
Drizzle one is blocked on an integration that does not yet exist."
```

- [ ] **Step 4: Report to the user**

Summarise: what shipped, what is blocked, which success criteria failed, and what the remaining roadmap phases need.

---

## Phase 6 exit criteria

- No `.catch(console.error)` anywhere in `apps/api/src`.
- Startup work runs as supervised fibers with spans; the production-only guard and the ordered chain are preserved.
- The runtime is disposed on shutdown so the postgres pool closes.
- ADR-006 exists.
- Every spec success criterion is recorded as PASS or FAIL with a measured value.

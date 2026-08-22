# Effect v4 Migration — Phase 4: Service Sweep Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: `superpowers:subagent-driven-development`. Steps use checkbox (`- [ ]`) syntax.
>
> **MANDATORY PREAMBLE:** Read `node_modules/effect/CLAUDE.md` and `node_modules/effect/ai-docs/src/01_effect/03_services/` before starting. Your training data is Effect v3; see the driver's rename table.

**Goal:** Migrate every remaining service to a `Context.Service`, following the pattern established by `MembersService` in Phase 1.

**Architecture:** Mechanical application of one recipe. By this phase the pattern exists in-repo as precedent — read `apps/api/src/services/members.service.ts` before each task and mirror it.

**Prerequisite:** Phases 1–3 complete.

**ALL TASKS IN THIS PHASE ARE `INDEPENDENT`.** A blocked service does not block the others — mark it `BLOCKED` in `STATE.md`, discard its changes, and move to the next. This is the one phase where the loop should keep going through failures.

---

### Task 4.0: Enumerate the actual work

The service list changes as the repo evolves — a service was added during this plan's authoring. Do not trust a hardcoded list.

- [ ] **Step 1: Generate the current worklist**

```bash
for f in $(find apps/api/src/services -name "*.ts" -not -name "*.test.ts" | sort); do
  n=$(basename "$f")
  if rg -q 'Context\.Service' "$f"; then s=DONE
  elif rg -q 'from "\.\./db' "$f"; then s=TODO-DB
  else s=TODO-PURE; fi
  echo "$s $n"
done
```

- [ ] **Step 2: Record it in `STATE.md`**

Append the output under a `## Phase 4 worklist` heading. Each `TODO-*` line becomes one task. Work them in the order printed.

`TODO-PURE` services have no `../db` import — they need only the error-taxonomy and `Effect.fn` treatment, not a `Database` dependency. They are quicker and should be done first to build momentum.

**Worklist as of authoring** (21 remaining; re-derive with Step 1 rather than trusting this):

`TODO-PURE`: `ai-profile-suggestions.ts`, `login-link.service.ts`, `memory-ranking.ts`, `og.service.ts`, `provisioning.service.ts`, `reciprocal-rank-fusion.ts`

`TODO-DB`: `ai-profile.service.ts`, `bot-settings.service.ts`, `digest.service.ts`, `events.service.ts`, `funds.service.ts`, `infra.service.ts`, `memory-backfill.service.ts`, `memory.service.ts`, `messages.service.ts`, `photos.service.ts`, `projects.service.ts`, `recall-calibration.ts`, `reputation.service.ts`, `stats.service.ts`, `venues.service.ts`

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/plans/STATE.md
git commit -m "chore: record phase 4 service worklist"
```

---

## The recipe — apply once per service

Every task below is: *"Migrate `<service>.ts` using this recipe."* The recipe is the complete instruction; there is no per-service variation beyond what the file already contains.

### Recipe steps

- [ ] **R1: Read the precedent and the target**

Read `apps/api/src/services/members.service.ts` (the reference implementation) and the target service in full. Note every exported function and its current return type.

- [ ] **R2: Write the failing test first**

Create `<service>.test.ts` (or extend the existing one). Minimum three tests:

```ts
import { describe, expect, it } from "@effect/vitest"
import { Effect, Layer } from "effect"
import { Database } from "../layers/database"
import { DbError } from "../errors"
import { TargetService } from "./target.service"

const dbReturning = (rows: ReadonlyArray<unknown>) =>
  Layer.succeed(Database)(Database.of({ use: () => Effect.succeed(rows as never) }))

const dbFailing = Layer.succeed(Database)(
  Database.of({
    use: (operation) => Effect.fail(new DbError({ operation, cause: new Error("down") })),
  }),
)

const withDb = (l: Layer.Layer<Database>) => TargetService.layer.pipe(Layer.provide(l))

describe("TargetService", () => {
  it.effect("returns the happy-path value", () =>
    Effect.gen(function*() {
      const svc = yield* TargetService
      // assert on the primary read method
    }).pipe(Effect.provide(withDb(dbReturning([/* fixture row */])))))

  it.effect("empty result is handled without throwing", () =>
    Effect.gen(function*() {
      const svc = yield* TargetService
      // Pick the assertion from the CURRENT return type of the method, which
      // you recorded in R1. The three cases that occur in this codebase:
      //   `return result[0] ?? null`  -> expect(...).toBeNull()
      //   returns a list/paginated    -> expect(...).toEqual([]) or .total === 0
      //   currently throws on missing -> assert a typed *NotFound failure:
      //       const r = yield* Effect.result(svc.method("x"))
      //       expect(r._tag).toBe("Failure")
      // Never invent a new behaviour here — mirror what the file does today.
    }).pipe(Effect.provide(withDb(dbReturning([])))))

  it.effect("database failure surfaces as a typed DbError", () =>
    Effect.gen(function*() {
      const svc = yield* TargetService
      const r = yield* Effect.result(/* primary method */)
      expect(r._tag).toBe("Failure")
      if (r._tag === "Failure") expect(r.failure._tag).toBe("DbError")
    }).pipe(Effect.provide(withDb(dbFailing))))
})
```

For `TODO-PURE` services, drop the `Database` layer and test the exported functions directly.

- [ ] **R3: Run the test and confirm it fails**

Run: `bun run test -- apps/api/src/services/<service>.test.ts`
Expected: FAIL — the service is not yet a `Context.Service`.

- [ ] **R4: Convert the service**

Transform the exported object literal into a `Context.Service` whose `layer` closes over its dependencies:

```ts
export class TargetService extends Context.Service<TargetService, {
  readonly methodA: (arg: string) => Effect.Effect<ResultType, DbError>
  // one entry per preserved method — errors explicit in every signature
}>()("api/services/TargetService") {
  static readonly layer = Layer.effect(
    TargetService,
    Effect.gen(function*() {
      const db = yield* Database

      const methodA = Effect.fn("TargetService.methodA")(function*(arg: string) {
        const rows = yield* db.use("target.methodA", (d) => /* the existing drizzle query, verbatim */)
        return rows[0] ?? null
      })

      return TargetService.of({ methodA })
    }),
  )
}
```

Rules, in priority order:

1. **Preserve behaviour exactly.** Copy each drizzle query verbatim into `db.use(...)`. Do not "improve" SQL, column sets, ordering, or pagination while migrating. Any behavioural change here is a bug.
2. **`noUncheckedIndexedAccess` is on** — `rows[0]` is `T | undefined`. Handle it explicitly. Never use `!`.
3. **Every `try`/`catch` becomes a typed error.** No `catch` that discards.
4. **Every `.catch(console.error)` becomes** either a mapped error or `runBackground(...)` from `runtime/`. Never silently dropped.
5. **No HTTP status codes in services.** Those belong to the seam.
6. **One file, one idiom.** Finish the file or revert it.

- [ ] **R5: Register the layer**

Add to `AppLayer` in `apps/api/src/runtime/index.ts`:

```ts
TargetService.layer.pipe(Layer.provide(Database.layer)),
```

- [ ] **R6: Update callers**

Find every consumer and route it through the service:

```bash
rg -n "targetService\." apps/api/src --glob '!*.test.ts'
```

Route callers use `runRoute` + `catchTags` (Phase 1, task 1.9 is the worked example). Bot callers keep their grammY signature and use `runHandler`. Callers still on the old idiom must be updated in this same task — never leave a dangling import.

- [ ] **R7: Run the gate**

Run: `bun run test && bun run type-check && bun lint`
Expected: green. `apps/web` must type-check unmodified.

- [ ] **R8: Commit**

```bash
git add apps/api/src
git commit -m "refactor: migrate <service> to an Effect Context.Service

Failure modes are explicit in the type signature and the service is
testable against a stub Database layer."
```

---

## Tasks

One task per `TODO-*` entry from Task 4.0. Each is `INDEPENDENT`.

Work `TODO-PURE` first, then `TODO-DB`. Within `TODO-DB`, prefer smaller files first — `funds.service.ts` (170 B), `infra.service.ts` (209 B), and `provisioning.service.ts` (155 B) are near-empty stubs and should take minutes.

- [ ] Task 4.1 — `ai-profile-suggestions.ts` (PURE)
- [ ] Task 4.2 — `reciprocal-rank-fusion.ts` (PURE)
- [ ] Task 4.3 — `memory-ranking.ts` (PURE)
- [ ] Task 4.4 — `login-link.service.ts` (PURE)
- [ ] Task 4.5 — `provisioning.service.ts` (PURE, stub)
- [ ] Task 4.6 — `og.service.ts` (PURE, large — 21 KB)
- [ ] Task 4.7 — `funds.service.ts` (DB, stub)
- [ ] Task 4.8 — `infra.service.ts` (DB, stub)
- [ ] Task 4.9 — `stats.service.ts` (DB)
- [ ] Task 4.10 — `photos.service.ts` (DB)
- [ ] Task 4.11 — `venues.service.ts` (DB)
- [ ] Task 4.12 — `bot-settings.service.ts` (DB)
- [ ] Task 4.13 — `recall-calibration.ts` (DB)
- [ ] Task 4.14 — `events.service.ts` (DB)
- [ ] Task 4.15 — `projects.service.ts` (DB)
- [ ] Task 4.16 — `messages.service.ts` (DB)
- [ ] Task 4.17 — `memory.service.ts` (DB)
- [ ] Task 4.18 — `memory-backfill.service.ts` (DB)
- [ ] Task 4.19 — `reputation.service.ts` (DB)
- [ ] Task 4.20 — `digest.service.ts` (DB)
- [ ] Task 4.21 — `ai-profile.service.ts` (DB, largest — 21 KB, depends on the `AI` layer from Phase 3)

If Task 4.0's enumeration produces entries not listed here, append them as further tasks. If a listed file no longer exists, mark it `SKIPPED — file removed` and continue.

---

### Task 4.22: Phase gate

- [ ] **Step 1: Confirm no service still imports the db singleton**

Run: `rg -l 'from "\.\./db"' apps/api/src/services | wc -l`
Expected: `0`. Any remainder is a `BLOCKED` service — list it in `STATE.md`.

- [ ] **Step 2: Confirm no service imports the bot singleton**

Run: `rg -l 'from "\.\./bot/bot"' apps/api/src/services | wc -l`
Expected: `0`

- [ ] **Step 3: Run the full gate**

Run: `bun run test && bun run type-check && bun lint`
Expected: green.

- [ ] **Step 4: Record completion**

Append `<iso-date> PHASE 4 COMPLETE` plus any `BLOCKED` services to `STATE.md`; set `current_phase: 5` and `status: AWAITING_REVIEW`.

**Phase 5 requires human review before it starts.** Stop here and report.

- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/plans/STATE.md
git commit -m "chore: mark Effect migration phase 4 complete"
```

---

## Phase 4 exit criteria

- No file under `services/` imports `../db` or `../bot/bot`.
- Every migrated service has at least three tests, including one asserting a typed `DbError`.
- `apps/web` type-checks unmodified.
- Any blocked service is listed in `STATE.md` with its error, and its changes are discarded.

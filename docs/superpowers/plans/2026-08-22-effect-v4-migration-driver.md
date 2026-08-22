# Effect v4 Migration — Autonomous Loop Driver

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` to implement the phase plans task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run the full Effect v4 migration unattended, phase by phase, leaving the repository green and shippable after every task.

**Architecture:** A driver loop reads `STATE.md`, finds the next unchecked task in the current phase plan, dispatches a subagent to execute it, runs a hard verification gate, and commits only on green. All progress is durable on disk, so an interrupted run resumes exactly where it stopped.

**Tech Stack:** Bun 1.3.6 · Effect `4.0.0-rc.111` · vitest + `@effect/vitest` · tsgo · Biome · Drizzle · ElysiaJS · grammY

**Source spec:** `docs/superpowers/specs/2026-08-22-effect-v4-migration-design.md`

---

## Phase plans, in execution order

| # | Plan file | Scope | Autonomy |
|---|---|---|---|
| 1 | `2026-08-22-effect-v4-migration-phase-1-foundation.md` | Enablers, vitest migration, `errors/`, `runtime/` seam, `Database` layer, **members pilot** | Full |
| 2 | `2026-08-22-effect-v4-migration-phase-2-resilience.md` | `retry.ts`→`Schedule`, `Http` layer, `tech-news.service.ts` | Full |
| 3 | `2026-08-22-effect-v4-migration-phase-3-ai.md` | `AI` layer, Voyage `EmbeddingModel`, `embeddings`/`ai` services | Full |
| 4 | `2026-08-22-effect-v4-migration-phase-4-services.md` | Remaining 20 services | Full |
| 5 | `2026-08-22-effect-v4-migration-phase-5-bot.md` | `bot/ai` toolkit + **16 hand-written agent loops** | **Supervised** |
| 6 | `2026-08-22-effect-v4-migration-phase-6-cleanup.md` | `bot/handlers`, `index.ts` supervised fibers | Full |

**Phase 5 is the one phase that stops for you.** Its first task builds one agent loop and then halts for review. The remaining 15 only proceed after you approve the pattern. This is deliberate: that work is design, not translation, and an unattended loop that gets it wrong 16 times is worse than one that stops once. Everything else runs to completion without you.

---

## MANDATORY PREAMBLE — every subagent, every task

Any agent executing a task in any phase plan MUST begin by reading:

1. `node_modules/effect/CLAUDE.md`
2. The relevant topic directory under `node_modules/effect/ai-docs/src/`

**Why this is not optional.** Every model's training data is Effect **v3**. v4 renamed a large amount of surface area. Already confirmed wrong-from-memory in this codebase's own design sessions:

| Recalled from training (v3) | Actual v4 |
|---|---|
| `@effect/schema` package | `effect/Schema` (v3 package is deprecated) |
| `@effect/platform`, `@effect/sql`, `@effect/ai` | `effect/unstable/{http,sql,ai}` |
| `Context.Tag` | `Context.Service<Self, Shape>()("id")` |
| `Data.TaggedError` | `Schema.TaggedError<E>()("Tag", {...})` |
| `Either` | `Result` |
| `Schedule.both` / `Schedule.intersect` | `Schedule.min([...])` + `Schedule.while` |
| `Effect.forkDaemon` | `Effect.forkDetach` |
| `Schema.decodeUnknown` | `Schema.decodeUnknownEffect` |
| `Layer.Layer.Success<T>` | `Layer.Success<T>` |
| `TimeoutException` (timeout tag) | `TimeoutError` |
| `Layer.scoped` | `Layer.effect` (it is scoped already) |

An agent that skips the preamble will write v3, fail the gate, and burn an iteration. Every time.

**Do NOT** consult effect.website, blog posts, or memory. Use only `node_modules/effect/`, which is version-matched to the pinned RC by construction.

---

## The verification gate

A task is complete **only** when all three pass:

```bash
bun run test          # phase 1 task 1.2 creates this script
bun run type-check
bun lint
```

Before phase 1 task 1.2 exists, the test command is `bun test`.

**Gate properties that make this safe to automate:**

- Fast — the suite runs in ~0.5s, so it can run on every task without slowing the loop.
- `tsgo` catches v4 API drift as a **type error**, before execution. Every rename in the table above was caught this way.
- Green means shippable. The app is never left broken between tasks.

---

## Loop protocol

Execute this until `STATE.md` reports `ALL PHASES COMPLETE` or `HALTED`.

```
 1. Read docs/superpowers/plans/STATE.md
 2. If status is HALTED or ALL PHASES COMPLETE -> stop, report to user.
 3. Open the current phase plan. Find the first task with unchecked `- [ ]` steps.
 4. If no unchecked task remains:
      - Append "PHASE <n> COMPLETE" to STATE.md
      - Advance current_phase; if phase 6 done -> ALL PHASES COMPLETE; stop.
      - If the newly-entered phase is 5 -> set status AWAITING_REVIEW; stop.
 5. Dispatch a subagent with: the MANDATORY PREAMBLE, the full task text, and the gate command.
 6. Run the gate.
 7. GREEN -> check off the task's steps, commit (message from the task), append a
    STATE.md log line: `<iso-date> phase <n> task <id> DONE <commit-sha>`. Go to 1.
 8. RED   -> apply the FAILURE POLICY below. Go to 1.
```

### Failure policy

This is where unattended loops usually die. The rules are explicit so they don't have to be improvised at 3am.

- **Attempt 1 fails** → re-dispatch with the gate output appended to the prompt. Do not change the task.
- **Attempt 2 fails** → re-dispatch once more, this time instructing the agent to re-read the relevant `ai-docs` topic first. Most second failures are v3-from-memory.
- **Attempt 3 fails** → `git restore --staged --worktree .` to discard the task's changes, mark the task `BLOCKED` in `STATE.md` with the final error, and move to the next **independent** task in the phase.
- **Never commit red.** A blocked task leaves the tree exactly as it was.

**Halt conditions** — set status `HALTED`, stop, and wait for a human:

- 3 tasks blocked in a row, or 5 blocked in total.
- The gate is red at the *start* of a task (means something outside the loop broke it).
- A task's own plan text is ambiguous or references a file that does not exist.
- Any task in phase 5 after the pattern-review halt.

### Task independence

Within a phase, tasks are ordered. A task may only be skipped when the phase plan marks it `INDEPENDENT`. Phase 4's per-service tasks are all independent of each other — one blocked service does not stop the other 19. Phase 1's tasks are strictly sequential: a blocked task there is a halt condition.

---

## STATE.md

Create it as the first action of phase 1, task 1.1. Format:

```markdown
# Effect v4 Migration — State

status: RUNNING          # RUNNING | AWAITING_REVIEW | HALTED | ALL PHASES COMPLETE
current_phase: 1
blocked_total: 0
blocked_streak: 0

## Log
2026-08-22T10:00:00Z phase 1 task 1.1 DONE a1b2c3d
```

The loop appends one line per task. Never rewrite history — append only. This file is the resume point after any interruption, including context loss.

---

## Guardrails

These hold for every phase.

1. **One file, one idiom.** A file is fully Effect or fully not. Never leave a half-migrated file.
2. **Commit only on green**, one commit per task, message specified by the task.
3. **Branch:** work on `dev`. Do not create feature branches or open PRs — this repo's convention (`CLAUDE.md`) and the user's standing preference.
4. **Never** run `drizzle-kit push`. Schema is untouched in this migration anyway.
5. **Do not touch** `apps/web`, `packages/shared/src/validators/`, Better Auth wiring, or Drizzle schema files. If a task appears to require it, that is a halt condition — it means the boundary was misunderstood.
6. **Eden Treaty invariant:** after any route change, `bun run --cwd apps/web type-check` must still pass with `apps/web` unmodified. Phase 1 task 1.9 adds this to the gate permanently.
7. **Pin exactly.** Never widen `effect`, `@effect/ai-anthropic`, or `@effect/vitest` to a range. All three move in lockstep.

8. **⚠ `apps/api/.env` `DATABASE_URL` points at PRODUCTION Neon.** Every test in
   every phase must run against a **stub layer** (`Layer.succeed(Database)(...)`),
   never `Database.layer`. The loop must never:
   - build `Database.layer`, `AppLayer`, or the `ManagedRuntime` inside a test;
   - run `bun run --cwd apps/api dev`, `db:migrate`, `db:seed`, or any script
     that opens a real connection;
   - run a "just check it works end to end" command against the live API.

   The gate is `bun run test && bun run type-check && bun lint` and nothing more.
   Verification is type-level and stub-level by design. If a task appears to
   require a live database, that is a **halt condition** — the task is wrong.

---

## Starting the loop

```
Read docs/superpowers/plans/2026-08-22-effect-v4-migration-driver.md and execute the
loop protocol until STATE.md reports ALL PHASES COMPLETE or HALTED.
```

Drive it with `superpowers:subagent-driven-development`, or wrap it in `/loop` for unattended operation. Phase 4 is a genuine fan-out (20 independent services) and is a good candidate for a `Workflow` if you want it parallelised.

---

## What to expect on return

- **Phases 1–4 complete**, repository green, ~45 files migrated, one commit per task.
- **Status `AWAITING_REVIEW`** at phase 5 task 5.2, with one worked agent-loop example to approve.
- Any `BLOCKED` entries listed in `STATE.md` with their errors, changes discarded, tree clean.

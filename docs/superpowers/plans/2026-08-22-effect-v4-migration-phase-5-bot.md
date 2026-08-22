# Effect v4 Migration — Phase 5: Bot & AI Agents Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: `superpowers:subagent-driven-development`. Steps use checkbox (`- [ ]`) syntax.
>
> **MANDATORY PREAMBLE:** Read `node_modules/effect/CLAUDE.md` and **all** of `node_modules/effect/ai-docs/src/71_ai/`. This phase writes agentic loops that Effect does not provide — the docs are the only correct reference.

**Goal:** Convert `bot/ai` to Effect: 47 tool definitions to `Toolkit`, and 16 multi-step agentic loops to hand-written recursive Effects.

**Architecture:** grammY handlers keep their `(ctx) => Promise<void>` signature; Effect lives inside, run via `runHandler`. Tools become `Tool.make` entries in a `Toolkit`. The agentic loop — which Effect has no built-in equivalent for — is written once, reviewed, then reused.

**Prerequisite:** Phases 1–4 complete.

---

## ⚠ THIS PHASE IS SUPERVISED

**Task 5.2 builds one agent loop and then HALTS for human review.** Tasks 5.3+ must not start until a human sets `status: RUNNING` in `STATE.md`.

This is deliberate. `LanguageModel.generateText` performs a *single* tool round-trip — model call, resolve tool calls, one follow-up with `toolChoice: "none"`. There is **no `maxSteps`** equivalent to the 16 `stepCountIs()` call sites. The loop must be written by hand, and an unattended agent that gets the semantics wrong 16 times is far worse than one that stops once for review.

---

## File Structure

| Path | Responsibility |
|---|---|
| `apps/api/src/bot/ai/toolkit.ts` | Create — the 47 tools as a `Toolkit` |
| `apps/api/src/bot/ai/loop.ts` | Create — the hand-written agentic loop |
| `apps/api/src/bot/ai/agent.ts` | Rewrite — use `loop.ts` |
| `apps/api/src/bot/ai/agents/*.ts` | Rewrite — 6 sub-agents |
| `apps/api/src/bot/ai/tools.ts` | Delete once `toolkit.ts` supersedes it |

---

### Task 5.1: Inventory the agentic surface

- [ ] **Step 1: Enumerate every loop and tool**

```bash
echo "--- stepCountIs call sites (loops to hand-write) ---"
rg -n "stepCountIs" apps/api/src --glob '!*.test.ts'
echo "--- tool() definitions ---"
rg -c "tool\(" apps/api/src/bot/ai/tools.ts
echo "--- files importing the AI SDK ---"
rg -l 'from "ai"|@ai-sdk' apps/api/src
```

- [ ] **Step 2: Record the inventory in `STATE.md`**

Under `## Phase 5 inventory`, record each `stepCountIs` site with its file, line, and step limit. Each becomes a loop to convert. Note the step limit — it is the loop's termination bound and must be preserved exactly.

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/plans/STATE.md
git commit -m "chore: record phase 5 agentic surface inventory"
```

---

### Task 5.2: The agentic loop — BUILD ONE, THEN HALT

**Files:**
- Create: `apps/api/src/bot/ai/loop.ts`
- Test: `apps/api/src/bot/ai/loop.test.ts`

- [ ] **Step 1: Read the reference material**

Read `node_modules/effect/ai-docs/src/71_ai/20_tools.ts` in full, then `node_modules/effect/src/unstable/ai/LanguageModel.ts` around the `generateText` implementation. Confirm for yourself how `disableToolCallResolution` changes the response shape — the loop depends on it.

- [ ] **Step 2: Write the failing test**

The loop must be testable without a real model. Drive it with a scripted sequence of responses.

```ts
import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { runAgentLoop } from "./loop"

describe("runAgentLoop", () => {
  it.effect("stops when the model returns no tool calls", () =>
    Effect.gen(function*() {
      const out = yield* runAgentLoop({
        maxSteps: 5,
        step: (n) => Effect.succeed({ toolCalls: [], text: `done at ${n}` }),
      })
      expect(out.steps).toBe(1)
      expect(out.text).toBe("done at 1")
    }))

  it.effect("iterates while the model keeps requesting tools", () =>
    Effect.gen(function*() {
      const out = yield* runAgentLoop({
        maxSteps: 5,
        step: (n) =>
          Effect.succeed(
            n < 3
              ? { toolCalls: [{ name: "t", args: {} }], text: "" }
              : { toolCalls: [], text: "finished" },
          ),
      })
      expect(out.steps).toBe(3)
      expect(out.text).toBe("finished")
    }))

  it.effect("enforces the step cap — the stepCountIs equivalent", () =>
    Effect.gen(function*() {
      const out = yield* runAgentLoop({
        maxSteps: 2,
        step: () => Effect.succeed({ toolCalls: [{ name: "t", args: {} }], text: "" }),
      })
      expect(out.steps).toBe(2)
      expect(out.stoppedBy).toBe("step-limit")
    }))
})
```

- [ ] **Step 3: Run it and confirm it fails**

Run: `bun run test -- apps/api/src/bot/ai/loop.test.ts`
Expected: FAIL — cannot resolve `./loop`.

- [ ] **Step 4: Implement the loop**

```ts
/**
 * Multi-step agentic loop.
 *
 * Effect's LanguageModel.generateText performs ONE tool round-trip: model call,
 * resolve tools, one follow-up with toolChoice "none". The AI SDK's
 * stepCountIs(n) had no equivalent, so the loop lives here.
 *
 * Written as an explicit recursion so it gains what the SDK's loop did not
 * give us: interruption, a span per step, and a typed error channel.
 */
import { Effect } from "effect"

export interface StepResult {
  readonly toolCalls: ReadonlyArray<{ name: string; args: unknown }>
  readonly text: string
}

export interface LoopResult {
  readonly text: string
  readonly steps: number
  readonly stoppedBy: "model" | "step-limit"
}

export interface LoopOptions<E, R> {
  readonly maxSteps: number
  readonly step: (stepNumber: number) => Effect.Effect<StepResult, E, R>
}

export const runAgentLoop = <E, R>(
  options: LoopOptions<E, R>,
): Effect.Effect<LoopResult, E, R> =>
  Effect.gen(function*() {
    let step = 0
    let last: StepResult = { toolCalls: [], text: "" }

    while (step < options.maxSteps) {
      step++
      last = yield* options.step(step).pipe(
        Effect.withSpan("agent.step", { attributes: { step } }),
      )
      if (last.toolCalls.length === 0) {
        return { text: last.text, steps: step, stoppedBy: "model" as const }
      }
    }

    return { text: last.text, steps: step, stoppedBy: "step-limit" as const }
  })
```

- [ ] **Step 5: Run the test**

Run: `bun run test -- apps/api/src/bot/ai/loop.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 6: Convert exactly ONE real call site**

Pick the smallest `stepCountIs` site from the Task 5.1 inventory. Wire it through `runAgentLoop`, preserving its step limit exactly. Leave the other 15 untouched.

- [ ] **Step 7: Run the gate**

Run: `bun run test && bun run type-check && bun lint`
Expected: green.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/bot/ai/loop.ts apps/api/src/bot/ai/loop.test.ts apps/api/src/bot/ai
git commit -m "feat: add hand-written agentic loop for Effect AI

effect/unstable/ai does a single tool round-trip with no maxSteps, so the
stepCountIs equivalent is written explicitly. Gains interruption and a
span per step. One call site converted as a reference."
```

- [ ] **Step 9: HALT for review**

Set `status: AWAITING_REVIEW` in `STATE.md` and append:

```
<iso-date> phase 5 task 5.2 AWAITING REVIEW — one agent loop converted,
review the pattern before the remaining 15 proceed.
```

**Stop. Report to the user. Do not continue to Task 5.3.**

---

### Task 5.3: Tools to Toolkit

*Blocked until a human sets `status: RUNNING`.*

**Files:**
- Create: `apps/api/src/bot/ai/toolkit.ts`
- Test: `apps/api/src/bot/ai/toolkit.test.ts`

- [ ] **Step 1: Convert each `tool()` to `Tool.make`**

Per `ai-docs/src/71_ai/20_tools.ts`, each tool gains a typed `success` schema and a `failureMode` — neither of which the AI SDK's `tool()` had:

```ts
import { Schema } from "effect"
import { Tool, Toolkit } from "effect/unstable/ai"

const FindMember = Tool.make("FindMember", {
  description: "Look up a community member by Telegram username",
  parameters: Schema.Struct({
    username: Schema.String.annotate({ description: "Telegram handle, without @" }),
  }),
  success: Schema.Struct({
    userId: Schema.String,
    name: Schema.String,
    bio: Schema.optional(Schema.String),
  }),
  // "error" surfaces handler failures in the calling effect's error channel;
  // "return" feeds them back to the model as a tool result.
  failureMode: "error",
})

export const BotToolkit = Toolkit.make(FindMember /* , ...the rest */)
```

Set `failureMode: "return"` for tools where the model should see and recover from the failure (lookups that may legitimately find nothing); `"error"` where a failure should abort the turn.

- [ ] **Step 2: Implement handlers via `toLayer`**

Handlers receive decoded parameters and depend on the Phase 1–4 services:

```ts
export const BotToolkitLayer = BotToolkit.toLayer(
  Effect.gen(function*() {
    const members = yield* MembersService
    return {
      FindMember: ({ username }) =>
        Effect.gen(function*() {
          const m = yield* members.findByUsername(username)
          if (m === null) return yield* new MemberNotFound({ userId: username })
          return { userId: m.userId, name: m.user.name, bio: m.bio ?? undefined }
        }),
    }
  }),
)
```

- [ ] **Step 3: Test the toolkit without a model**

Assert that each handler resolves against stub service layers. Do not call a real provider.

- [ ] **Step 4: Run the gate and commit**

Run: `bun run test && bun run type-check && bun lint`

```bash
git add apps/api/src/bot/ai/toolkit.ts apps/api/src/bot/ai/toolkit.test.ts
git commit -m "feat: convert bot tools to an Effect Toolkit

Each tool gains a typed success schema and an explicit failure mode."
```

---

### Task 5.4–5.18: Convert the remaining 15 agent loops

*Blocked until Task 5.2 is reviewed and approved.*

One task per remaining `stepCountIs` site from the Task 5.1 inventory. Each follows Task 5.2's Step 6 exactly: wire the site through `runAgentLoop`, preserving its step limit, then run the gate and commit.

These tasks are `INDEPENDENT` of one another once the pattern is approved.

- [ ] **Per-site recipe**
  1. Read the call site and record its current step limit.
  2. Replace the AI SDK `generateText({ ..., stopWhen: stepCountIs(n) })` with `runAgentLoop({ maxSteps: n, step })`.
  3. Preserve the step limit **exactly** — it is a cost control, not a default.
  4. Run `bun run test && bun run type-check && bun lint`.
  5. Commit with `refactor: convert <site> to the Effect agentic loop`.

---

### Task 5.19: Convert `bot/handlers` and `bot/lib`

- [ ] **Step 1: Keep grammY signatures, move Effect inside**

Handlers stay `(ctx) => Promise<void>`. The body becomes:

```ts
bot.command("profile", async (ctx) => {
  await runHandler(
    Effect.gen(function*() {
      const members = yield* MembersService
      // ...
    }).pipe(
      Effect.catchTags({
        MemberNotFound: () => Effect.sync(() => ctx.reply("No profile found.")),
        DbError: (e) => Effect.logError("profile lookup failed", e),
      }),
    ),
  )
})
```

- [ ] **Step 2: Remove the last AI SDK imports**

Run: `rg -l 'from "ai"|@ai-sdk' apps/api/src`
Expected: no matches once every handler is converted.

- [ ] **Step 3: Run the gate and commit**

```bash
git add apps/api/src/bot
git commit -m "refactor: run bot handlers through the Effect seam"
```

---

### Task 5.20: Phase gate

- [ ] **Step 1: Confirm the AI SDK is fully removed**

```bash
rg -l 'from "ai"|@ai-sdk' apps/api/src | wc -l   # expect 0
```

- [ ] **Step 2: Drop the dependencies if fully unused**

```bash
cd apps/api && bun remove ai @ai-sdk/anthropic
```

Only if Step 1 returned `0`.

- [ ] **Step 3: Run the full gate**

Run: `bun run test && bun run type-check && bun lint`
Expected: green.

- [ ] **Step 4: Record completion**

Append `<iso-date> PHASE 5 COMPLETE` to `STATE.md`; set `current_phase: 6`, `status: RUNNING`.

- [ ] **Step 5: Commit**

```bash
git add apps/api/package.json bun.lock docs/superpowers/plans/STATE.md
git commit -m "chore: mark Effect migration phase 5 complete"
```

---

## Phase 5 exit criteria

- `runAgentLoop` exists, is tested including its step cap, and backs all 16 former `stepCountIs` sites.
- Every step limit is preserved exactly as it was.
- 47 tools are `Toolkit` entries with typed success schemas.
- No file imports `"ai"` or `@ai-sdk/*`.
- `bot/handlers` keep their grammY signatures.

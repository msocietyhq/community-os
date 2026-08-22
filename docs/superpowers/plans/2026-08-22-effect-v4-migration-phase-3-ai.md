# Effect v4 Migration — Phase 3: AI Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: `superpowers:subagent-driven-development`. Steps use checkbox (`- [ ]`) syntax.
>
> **MANDATORY PREAMBLE:** Read `node_modules/effect/CLAUDE.md` and **all** of `node_modules/effect/ai-docs/src/71_ai/` (`index.md`, `10_language-model.ts`, `20_tools.ts`, `30_chat.ts`) before starting. Effect's AI modules are v4-only; nothing in your training data describes them correctly.

**Goal:** Stand up the `AI` and `Embeddings` layers on `effect/unstable/ai`, and migrate `embeddings.service.ts` and `ai.service.ts` onto them.

**Architecture:** `effect/unstable/ai` provides the provider-agnostic `LanguageModel` and `EmbeddingModel`; `@effect/ai-anthropic` provides the Claude client. Voyage has no Effect provider, so `EmbeddingModel.make` wraps it — which also replaces the hand-rolled `BATCH_SIZE = 128` logic with Effect's built-in request batching.

**Prerequisite:** Phases 1–2 complete.

**Scope note:** This phase converts only the *service-local* Zod schemas used for `generateObject`. It must NOT touch `packages/shared/src/validators/` — those are the API contract feeding Eden Treaty and `apps/web`, and are explicitly Phase 2 of the spec's gated roadmap (out of scope here).

---

## File Structure

| Path | Responsibility |
|---|---|
| `apps/api/src/layers/ai.ts` | Create — `LanguageModel` wired to Anthropic |
| `apps/api/src/layers/embeddings.ts` | Create — Voyage as an `EmbeddingModel` |
| `apps/api/src/services/embeddings.service.ts` | Rewrite — use the layer |
| `apps/api/src/services/ai.service.ts` | Rewrite — use the layer |

---

### Task 3.1: Install the Anthropic provider

- [ ] **Step 1: Install, pinned in lockstep with `effect`**

```bash
cd apps/api
bun add @effect/ai-anthropic@4.0.0-rc.111 --exact
```

- [ ] **Step 2: Verify the version matches `effect` exactly**

Run: `node -e "const p=require('./package.json');const d=p.dependencies;console.log(d.effect === d['@effect/ai-anthropic'] ? 'LOCKSTEP OK' : 'MISMATCH: '+d.effect+' vs '+d['@effect/ai-anthropic'])"`
Expected: `LOCKSTEP OK`

- [ ] **Step 3: Commit**

```bash
git add apps/api/package.json bun.lock
git commit -m "build: add @effect/ai-anthropic pinned in lockstep with effect"
```

---

### Task 3.2: AI layer

**Files:**
- Create: `apps/api/src/layers/ai.ts`
- Test: `apps/api/src/layers/ai.test.ts`

- [ ] **Step 1: Read the reference implementation**

Read `node_modules/effect/ai-docs/src/71_ai/10_language-model.ts` and `20_tools.ts` in full. The layer below follows their structure; if the installed version's API differs from what is written here, **follow the ai-docs, not this plan**, and note the discrepancy in `STATE.md`.

- [ ] **Step 2: Write the failing test**

```ts
import { describe, expect, it } from "@effect/vitest"
import { Effect, Layer, Schema } from "effect"
import { LanguageModel } from "effect/unstable/ai"
import { AI } from "./ai"

describe("AI layer", () => {
  it.effect("generateObject decodes into the provided Schema", () =>
    Effect.gen(function*() {
      const ai = yield* AI
      const Out = Schema.Struct({ title: Schema.String })
      const result = yield* ai.object(Out, "irrelevant prompt")
      expect(result.title).toBe("stubbed")
    }).pipe(Effect.provide(AI.stub({ object: { title: "stubbed" } }))))
})
```

- [ ] **Step 3: Run it and confirm it fails**

Run: `bun run test -- apps/api/src/layers/ai.test.ts`
Expected: FAIL — cannot resolve `./ai`.

- [ ] **Step 4: Implement**

```ts
/**
 * Language model boundary.
 *
 * Wraps effect/unstable/ai so services depend on an interface rather than the
 * Vercel AI SDK, and so tests can substitute a deterministic stub instead of
 * calling a real provider.
 */
import { Context, Effect, Layer, Schema, Config } from "effect"
import { LanguageModel } from "effect/unstable/ai"
import { AnthropicClient, AnthropicLanguageModel } from "@effect/ai-anthropic"
import { FetchHttpClient } from "effect/unstable/http"

export class AI extends Context.Service<AI, {
  readonly text: (prompt: string) => Effect.Effect<string, unknown>
  readonly object: <S extends Schema.Top>(
    schema: S,
    prompt: string,
  ) => Effect.Effect<S["Type"], unknown>
}>()("api/layers/AI") {
  static readonly layer = Layer.effect(
    AI,
    Effect.gen(function*() {
      return AI.of({
        text: (prompt) =>
          LanguageModel.generateText({ prompt }).pipe(Effect.map((r) => r.text)),
        object: (schema, prompt) =>
          LanguageModel.generateObject({ prompt, schema }).pipe(Effect.map((r) => r.value)),
      })
    }),
  ).pipe(
    Layer.provide(
      AnthropicLanguageModel.layer({ model: "claude-sonnet-4-5" }).pipe(
        Layer.provide(
          AnthropicClient.layerConfig({ apiKey: Config.redacted("ANTHROPIC_API_KEY") }),
        ),
        Layer.provide(FetchHttpClient.layer),
      ),
    ),
  )

  /** Deterministic stub for tests — never calls a provider. */
  static readonly stub = (canned: { text?: string; object?: unknown }) =>
    Layer.succeed(AI)(
      AI.of({
        text: () => Effect.succeed(canned.text ?? ""),
        object: () => Effect.succeed(canned.object as never),
      }),
    )
}
```

The provider names above are **verified** against `@effect/ai-anthropic@4.0.0-rc.111`:

- `AnthropicClient` exports `layer`, `layerConfig`, `make`
- `AnthropicLanguageModel` exports `layer`, `make`, `model`, `Config`, `withConfigOverride`

The package also exports `AnthropicTool` and `AnthropicTelemetry`, which Phase 5 uses.

If the model id `claude-sonnet-4-5` is rejected, list the accepted ids from
`AnthropicLanguageModel.Config` rather than guessing, and record the chosen id in
`STATE.md` so later tasks stay consistent.

- [ ] **Step 5: Run the test**

Run: `bun run test -- apps/api/src/layers/ai.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/layers/ai.ts apps/api/src/layers/ai.test.ts
git commit -m "feat: add AI layer on effect/unstable/ai with Anthropic provider

Services depend on an interface, so tests substitute a deterministic stub
instead of calling a real model."
```

---

### Task 3.3: Voyage embeddings as an EmbeddingModel

**Files:**
- Create: `apps/api/src/layers/embeddings.ts`
- Test: `apps/api/src/layers/embeddings.test.ts`

Voyage has no Effect provider. `EmbeddingModel.make` wraps it and supplies a request resolver that batches concurrent `embed` calls into one `embedMany` — replacing the manual `BATCH_SIZE = 128` chunking in the current `embeddings.service.ts`.

- [ ] **Step 1: Read the constructor contract**

Run: `sed -n '150,240p' node_modules/effect/src/unstable/ai/EmbeddingModel.ts`

Note the documented gotcha: provider responses are interpreted **positionally** and must return exactly one result per input, or it fails with `AiError.InvalidOutputError`. The current service already asserts this by hand (`embeddings.service.ts:35`); that assertion becomes the layer's responsibility.

- [ ] **Step 2: Write the failing test**

```ts
import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { Embeddings } from "./embeddings"

describe("Embeddings", () => {
  it.effect("batches concurrent embed calls into one provider request", () =>
    Effect.gen(function*() {
      const calls: Array<ReadonlyArray<string>> = []
      const layer = Embeddings.make(async (inputs) => {
        calls.push(inputs)
        return inputs.map((_, i) => [i, i, i])
      })

      const out = yield* Effect.forEach(
        ["a", "b", "c"],
        (t) => Effect.flatMap(Embeddings, (e) => e.embed(t)),
        { concurrency: "unbounded" },
      ).pipe(Effect.provide(layer))

      expect(out).toHaveLength(3)
      expect(calls).toHaveLength(1)      // three embeds, one provider call
      expect(calls[0]).toEqual(["a", "b", "c"])
    }))
})
```

- [ ] **Step 3: Run it and confirm it fails**

Run: `bun run test -- apps/api/src/layers/embeddings.test.ts`
Expected: FAIL — cannot resolve `./embeddings`.

- [ ] **Step 4: Implement**

Follow `EmbeddingModel.make` as documented in the source read at Step 1, wrapping `VoyageAIClient.embed` with model `voyage-3-lite`. Expose:

```ts
export class Embeddings extends Context.Service<Embeddings, {
  readonly embed: (text: string) => Effect.Effect<ReadonlyArray<number>, unknown>
  readonly embedMany: (texts: ReadonlyArray<string>) =>
    Effect.Effect<ReadonlyArray<ReadonlyArray<number>>, unknown>
}>()("api/layers/Embeddings") {
  /** Test seam: inject the provider call directly. */
  static readonly make: (
    provider: (inputs: ReadonlyArray<string>) => Promise<ReadonlyArray<ReadonlyArray<number>>>,
  ) => Layer.Layer<Embeddings>
  /** Production: VoyageAIClient with env.VOYAGE_API_KEY. */
  static readonly layer: Layer.Layer<Embeddings>
}
```

- [ ] **Step 5: Run the test**

Run: `bun run test -- apps/api/src/layers/embeddings.test.ts`
Expected: PASS — and critically, `calls` has length 1, proving batching works.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/layers/embeddings.ts apps/api/src/layers/embeddings.test.ts
git commit -m "feat: wrap Voyage as an Effect EmbeddingModel

Effect's request resolver batches concurrent embed calls, replacing the
hand-managed BATCH_SIZE=128 chunking."
```

---

### Task 3.4: Migrate `embeddings.service.ts`

**Files:**
- Modify: `apps/api/src/services/embeddings.service.ts`

- [ ] **Step 1: Convert to a `Context.Service`**

Follow the `MembersService` pattern (Phase 1, task 1.8). Depend on `Embeddings` and `Database`. Delete the module-level `new VoyageAIClient(...)` and the manual batching loop.

Replace the two `throw new Error("[embeddings] ...")` sites (`:19`, `:35`) with typed failures — the positional-count guarantee is now enforced by the layer, so these become `Effect.die` only if they represent genuine invariant violations.

- [ ] **Step 2: Register in the runtime**

Add `Embeddings.layer` and the service layer to `AppLayer` in `apps/api/src/runtime/index.ts`.

- [ ] **Step 3: Run the gate**

Run: `bun run test && bun run type-check && bun lint`
Expected: green.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/services/embeddings.service.ts apps/api/src/runtime/index.ts
git commit -m "refactor: migrate embeddings service onto the Embeddings layer"
```

---

### Task 3.5: Migrate `ai.service.ts`

**Files:**
- Modify: `apps/api/src/services/ai.service.ts`

This file imports `generateText`, `generateObject`, and `LanguageModel` from the Vercel AI SDK.

- [ ] **Step 1: Convert the service-local Zod schemas to `effect/Schema`**

Only the schemas defined in this file. Do not touch `packages/shared`.

- [ ] **Step 2: Replace AI SDK calls with the `AI` layer**

`generateText(...)` → `ai.text(...)`; `generateObject({ schema, ... })` → `ai.object(Schema, prompt)`.

- [ ] **Step 3: Convert to a `Context.Service` and register it in `AppLayer`**

- [ ] **Step 4: Run the gate**

Run: `bun run test && bun run type-check && bun lint`
Expected: green.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/ai.service.ts apps/api/src/runtime/index.ts
git commit -m "refactor: migrate ai.service onto effect/unstable/ai"
```

---

### Task 3.6: Phase gate

- [ ] **Step 1: Run the full gate**

Run: `bun run test && bun run type-check && bun lint`
Expected: green.

- [ ] **Step 2: Confirm the contract validators were not touched**

Run: `git diff --name-only HEAD~6 -- packages/shared/src/validators/ | wc -l`
Expected: `0`. If non-zero, this phase violated its scope — HALT.

- [ ] **Step 3: Record completion**

Append `<iso-date> PHASE 3 COMPLETE` to `STATE.md`; set `current_phase: 4`.

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/plans/STATE.md
git commit -m "chore: mark Effect migration phase 3 complete"
```

---

## Phase 3 exit criteria

- `@effect/ai-anthropic` pinned at the same exact version as `effect`.
- `layers/ai.ts` and `layers/embeddings.ts` exist, each with a test-only stub seam.
- `embeddings.service.ts` no longer constructs `VoyageAIClient` or chunks by hand.
- `ai.service.ts` imports nothing from `"ai"` or `@ai-sdk/*`.
- `packages/shared/src/validators/` is untouched.

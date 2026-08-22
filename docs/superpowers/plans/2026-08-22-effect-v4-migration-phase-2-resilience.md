# Effect v4 Migration — Phase 2: Resilience Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: `superpowers:subagent-driven-development`. Steps use checkbox (`- [ ]`) syntax.
>
> **MANDATORY PREAMBLE:** Read `node_modules/effect/CLAUDE.md` and `node_modules/effect/ai-docs/src/06_schedule/` before starting. Your training data is Effect v3. See the driver's rename table.

**Goal:** Replace the hand-rolled retry machinery with `Schedule`, add a typed `Http` layer, and convert `tech-news.service.ts` from unbounded `Promise.all` to bounded, interruptible concurrency.

**Architecture:** Retry policy becomes data (`Schedule`) rather than a loop. Retryability becomes a field on the error rather than a regex over its message. Fan-out gains an explicit concurrency bound.

**Prerequisite:** Phase 1 complete — `errors/`, `layers/database.ts`, `runtime/` all exist and are green.

---

## File Structure

| Path | Responsibility |
|---|---|
| `apps/api/src/lib/schedules.ts` | Create — shared retry policies |
| `apps/api/src/layers/http.ts` | Create — fetch boundary with timeout, maps to `HttpError` |
| `apps/api/src/lib/retry.ts` | Delete — superseded by `schedules.ts` |
| `apps/api/src/lib/retry.test.ts` | Delete — replaced by `schedules.test.ts` |
| `apps/api/src/lib/schedules.test.ts` | Create — TestClock-driven, no injected `sleep`/`random` |
| `apps/api/src/services/tech-news.service.ts` | Rewrite — bounded concurrency |

---

### Task 2.1: Shared retry schedules

**Files:**
- Create: `apps/api/src/lib/schedules.ts`
- Test: `apps/api/src/lib/schedules.test.ts`

The current `lib/retry.ts` is ~115 lines implementing exponential backoff, full jitter, `Retry-After` parsing, and a transient-error regex — and it injects `sleep` and `random` purely so tests need not wait. `Schedule` plus `TestClock` removes all of that.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "@effect/vitest"
import { Effect, Fiber } from "effect"
import { TestClock } from "effect/testing"
import { transientRetry } from "./schedules"
import { HttpError } from "../errors"

const failing = (times: number, retryable: boolean) => {
  let n = 0
  return Effect.suspend(() => {
    n++
    return n <= times
      ? Effect.fail(new HttpError({ url: "u", retryable, cause: new Error("x") }))
      : Effect.succeed(n)
  })
}

describe("transientRetry", () => {
  it.effect("retries transient failures until success", () =>
    Effect.gen(function*() {
      const fiber = yield* Effect.forkChild(failing(2, true).pipe(Effect.retry(transientRetry)))
      yield* TestClock.adjust("5 minutes")
      expect(yield* Fiber.join(fiber)).toBe(3)
    }))

  it.effect("does not retry a non-retryable failure", () =>
    Effect.gen(function*() {
      const fiber = yield* Effect.forkChild(
        Effect.result(failing(2, false).pipe(Effect.retry(transientRetry))),
      )
      yield* TestClock.adjust("5 minutes")
      const r = yield* Fiber.join(fiber)
      expect(r._tag).toBe("Failure")
    }))

  it.effect("gives up after the attempt cap", () =>
    Effect.gen(function*() {
      const fiber = yield* Effect.forkChild(
        Effect.result(failing(99, true).pipe(Effect.retry(transientRetry))),
      )
      yield* TestClock.adjust("30 minutes")
      const r = yield* Fiber.join(fiber)
      expect(r._tag).toBe("Failure")
    }))
})
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `bun run test -- apps/api/src/lib/schedules.test.ts`
Expected: FAIL — cannot resolve `./schedules`.

- [ ] **Step 3: Implement**

```ts
/**
 * Shared retry policies.
 *
 * Replaces lib/retry.ts. Every knob that file spelled out by hand —
 * DEFAULT_ATTEMPTS, BASE/MAX delay, full jitter, isRetryableError — is
 * expressed here as data. Clock and Random come from the Effect runtime, so
 * tests use TestClock instead of injected `sleep` and `random` parameters.
 */
import { Duration, Schedule } from "effect"
import type { HttpError, TelegramError } from "../errors"

/** Anything carrying a retryability decision made at construction time. */
type Retryable = HttpError | TelegramError

/**
 * Exponential backoff from 2s, capped at 60s, full jitter, 4 attempts total,
 * and only while the error says it is worth retrying.
 */
export const transientRetry = Schedule.min([
  Schedule.exponential(Duration.seconds(2), 2),
  Schedule.spaced(Duration.seconds(60)),
]).pipe(
  Schedule.jittered,
  Schedule.setInputType<Retryable>(),
  Schedule.while(({ input, attempt }) => input.retryable && attempt < 4),
)

/** Tighter policy for latency-sensitive paths (a Telegram reply, say). */
export const quickRetry = Schedule.exponential(Duration.millis(250), 2).pipe(
  Schedule.jittered,
  Schedule.setInputType<Retryable>(),
  Schedule.while(({ input, attempt }) => input.retryable && attempt < 3),
)
```

- [ ] **Step 4: Run the test**

Run: `bun run test -- apps/api/src/lib/schedules.test.ts`
Expected: PASS, 3 tests — and they complete in milliseconds despite simulating 30 minutes of backoff, because `TestClock` advances virtual time.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/lib/schedules.ts apps/api/src/lib/schedules.test.ts
git commit -m "feat: express retry policy as an Effect Schedule

Replaces hand-rolled backoff/jitter. TestClock removes the need to inject
sleep and random purely for testability."
```

---

### Task 2.2: Http layer

**Files:**
- Create: `apps/api/src/layers/http.ts`
- Test: `apps/api/src/layers/http.test.ts`

Uses stable core plus `fetch` rather than `effect/unstable/http`, to keep Phase 2 on stable modules.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "@effect/vitest"
import { Effect, Layer } from "effect"
import { Http } from "./http"

const stub = (impl: typeof fetch) => Http.make(impl)

describe("Http", () => {
  it.effect("returns parsed JSON on success", () =>
    Effect.gen(function*() {
      const http = yield* Http
      const out = yield* http.getJson<{ ok: boolean }>("https://x.test/a")
      expect(out.ok).toBe(true)
    }).pipe(
      Effect.provide(stub((() =>
        Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }))) as typeof fetch)),
    ))

  it.effect("marks 5xx as retryable and 4xx as not", () =>
    Effect.gen(function*() {
      const http = yield* Http
      const r = yield* Effect.result(http.getJson("https://x.test/a"))
      expect(r._tag).toBe("Failure")
      if (r._tag === "Failure") {
        expect(r.failure._tag).toBe("HttpError")
        expect(r.failure.status).toBe(503)
        expect(r.failure.retryable).toBe(true)
      }
    }).pipe(
      Effect.provide(stub((() =>
        Promise.resolve(new Response("nope", { status: 503 }))) as typeof fetch)),
    ))

  it.effect("a 400 is not retryable", () =>
    Effect.gen(function*() {
      const http = yield* Http
      const r = yield* Effect.result(http.getJson("https://x.test/a"))
      if (r._tag === "Failure") expect(r.failure.retryable).toBe(false)
    }).pipe(
      Effect.provide(stub((() =>
        Promise.resolve(new Response("bad", { status: 400 }))) as typeof fetch)),
    ))
})
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `bun run test -- apps/api/src/layers/http.test.ts`
Expected: FAIL — cannot resolve `./http`.

- [ ] **Step 3: Implement**

```ts
/**
 * fetch boundary as an Effect service.
 *
 * Retryability is decided here, once, from the status code — replacing the
 * TRANSIENT_MESSAGE regex in the old lib/retry.ts. Timeouts are enforced by
 * Effect.timeout rather than AbortSignal.timeout, so a cancelled request also
 * interrupts everything downstream of it.
 */
import { Context, Duration, Effect, Layer } from "effect"
import { HttpError } from "../errors"

const DEFAULT_TIMEOUT = Duration.seconds(15)

export class Http extends Context.Service<Http, {
  readonly getJson: <A>(url: string, init?: RequestInit) => Effect.Effect<A, HttpError>
  readonly postJson: <A>(url: string, body: unknown, init?: RequestInit) => Effect.Effect<A, HttpError>
}>()("api/layers/Http") {
  static readonly make = (fetchImpl: typeof fetch) => {
    const request = <A>(url: string, init?: RequestInit): Effect.Effect<A, HttpError> =>
      Effect.tryPromise({
        try: async () => {
          const res = await fetchImpl(url, init)
          if (!res.ok) {
            throw new HttpError({
              url,
              status: res.status,
              retryable: res.status === 429 || res.status >= 500,
              cause: new Error(`HTTP ${res.status}`),
            })
          }
          return (await res.json()) as A
        },
        catch: (cause) =>
          cause instanceof HttpError
            ? cause
            : new HttpError({ url, retryable: true, cause }),
      }).pipe(
        Effect.timeout(DEFAULT_TIMEOUT),
        // v4 tag is "TimeoutError". v3's "TimeoutException" does NOT exist here.
        Effect.catchTag("TimeoutError", () =>
          Effect.fail(new HttpError({ url, retryable: true, cause: new Error("timeout") }))),
      )

    return Layer.succeed(Http)(
      Http.of({
        getJson: (url, init) => request(url, init),
        postJson: (url, body, init) =>
          request(url, {
            ...init,
            method: "POST",
            headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
            body: JSON.stringify(body),
          }),
      }),
    )
  }

  static readonly layer = Http.make(fetch)
}
```

This exact code has been type-checked against `effect@4.0.0-rc.111` with `drizzle-orm`, `postgres`, `strict`, `noUncheckedIndexedAccess`, and `exactOptionalPropertyTypes` all enabled. Transcribe it as written.

- [ ] **Step 4: Run the test**

Run: `bun run test -- apps/api/src/layers/http.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/layers/http.ts apps/api/src/layers/http.test.ts
git commit -m "feat: add Http layer with typed errors and Effect-level timeouts

Retryability is derived from the status code once, replacing the
transient-message regex in lib/retry.ts."
```

---

### Task 2.3: Migrate `tech-news.service.ts`

**Files:**
- Modify: `apps/api/src/services/tech-news.service.ts`
- Test: existing `tech-news-cache.test.ts`, `tech-news-schema.test.ts` must keep passing

Read the file first. It fans out to Hacker News, Exa, and GitHub with `Promise.all` and no concurrency bound, wrapping each item in `try`/`catch` that discards failures.

- [ ] **Step 1: Record the behavioural baseline**

Run: `bun run test -- apps/api/src/services/tech-news-cache.test.ts apps/api/src/services/tech-news-schema.test.ts`
Expected: PASS. These must still pass unchanged at the end of this task — they are the regression guard.

- [ ] **Step 2: Convert the fan-out helpers**

Replace each `Promise.all` over per-item fetches with a bounded `Effect.forEach`, and each swallowing `try`/`catch` with `Effect.result` so failures become data instead of vanishing. `fetchHnStories` is the worked example (currently at `tech-news.service.ts:173`):

```ts
const fetchHnStories = Effect.fn("techNews.fetchHnStories")(function*() {
  const http = yield* Http
  const ids = yield* http.getJson<ReadonlyArray<number>>(HN_TOP_URL).pipe(
    Effect.retry(transientRetry),
  )

  const results = yield* Effect.forEach(
    ids.slice(0, HN_STORY_LIMIT),
    (id) =>
      http.getJson<HnStory>(`${HN_ITEM_URL}/${id}.json`).pipe(
        Effect.retry(transientRetry),
        Effect.result,
      ),
    { concurrency: 8 },
  )

  // Failures are now visible instead of silently dropped.
  const failures = results.filter((r) => r._tag === "Failure").length
  if (failures > 0) yield* Effect.logWarning(`hn: ${failures} stories failed`)

  return results.flatMap((r) => (r._tag === "Success" ? [r.value] : []))
})
```

Apply the same shape to `exaSearch` (`:242`), `fetchStories` (`:269`), `githubFetch` (`:352`), and `discoverRepos` (`:406`). Delete the `AbortSignal.timeout(FETCH_TIMEOUT_MS)` arguments — `Http` enforces the timeout.

- [ ] **Step 3: Expose the service through the layer**

Follow the `MembersService` pattern from Phase 1 task 1.8: a `Context.Service` named `TechNewsService`, with `layer` depending on `Http` and `Database`.

- [ ] **Step 4: Register it in the runtime**

In `apps/api/src/runtime/index.ts`, add to `AppLayer`:

```ts
Http.layer,
TechNewsService.layer.pipe(Layer.provide(Layer.mergeAll(Http.layer, Database.layer))),
```

- [ ] **Step 5: Run the regression guard and the full suite**

Run: `bun run test && bun run type-check && bun lint`
Expected: green, with the two tech-news tests still passing.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/services/tech-news.service.ts apps/api/src/runtime/index.ts
git commit -m "refactor: bound tech-news fan-out concurrency and surface failures

Unbounded Promise.all over HN/Exa/GitHub becomes Effect.forEach with an
explicit cap; per-item failures are logged rather than silently dropped."
```

---

### Task 2.4: Delete the old retry module

**Files:**
- Delete: `apps/api/src/lib/retry.ts`, `apps/api/src/lib/retry.test.ts`

- [ ] **Step 1: Confirm nothing still imports it**

Run: `rg -n 'from "\.\./lib/retry"|from "\./retry"|withRetry|isRetryableError|retryAfterMs' apps/api/src`
Expected: no matches. If any remain, migrate those call sites to `transientRetry` first — do not delete while referenced.

- [ ] **Step 2: Delete**

```bash
git rm apps/api/src/lib/retry.ts apps/api/src/lib/retry.test.ts
```

- [ ] **Step 3: Run the gate**

Run: `bun run test && bun run type-check && bun lint`
Expected: green.

- [ ] **Step 4: Commit**

```bash
git commit -m "chore: remove hand-rolled retry module

Superseded by lib/schedules.ts. Fulfils a phase-1 success criterion from
the migration spec."
```

---

### Task 2.5: Phase gate

- [ ] **Step 1: Run the full gate**

Run: `bun run test && bun run type-check && bun lint`
Expected: green.

- [ ] **Step 2: Record completion**

Append `<iso-date> PHASE 2 COMPLETE` to `docs/superpowers/plans/STATE.md` and set `current_phase: 3`.

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/plans/STATE.md
git commit -m "chore: mark Effect migration phase 2 complete"
```

---

## Phase 2 exit criteria

- `lib/retry.ts` and its test are deleted; no references remain.
- `lib/schedules.ts` is tested with `TestClock` and no injected `sleep`/`random`.
- `layers/http.ts` decides retryability from status codes, not message regexes.
- `tech-news.service.ts` has no unbounded `Promise.all` and no failure-swallowing `catch`.

# Effect v4 Migration — Phase 1: Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **MANDATORY PREAMBLE:** Before any task, read `node_modules/effect/CLAUDE.md` and the relevant topic under `node_modules/effect/ai-docs/src/`. Your training data is Effect **v3**; this repo uses **v4**, which renamed much of the surface. See the driver's rename table. Do not consult effect.website or memory.

**Goal:** Establish the Effect v4 foundation — pinned deps, vitest, error taxonomy, `Database`/`Telegram` layers, the route seam — and prove it end-to-end by migrating the `members` service and route.

**Architecture:** Effect lives inside `services/`. A `ManagedRuntime` seam runs it at the Elysia edge, returning the same plain objects handlers return today, so `typeof app` and Eden Treaty inference into `apps/web` are structurally unchanged.

**Tech Stack:** Bun 1.3.6 · Effect `4.0.0-rc.111` · vitest + `@effect/vitest` · tsgo · Drizzle · ElysiaJS

**Spec:** `docs/superpowers/specs/2026-08-22-effect-v4-migration-design.md`

**Tasks are strictly sequential.** A blocked task here is a halt condition — later tasks depend on earlier ones.

---

## File Structure

| Path | Responsibility |
|---|---|
| `docs/superpowers/plans/STATE.md` | Create — durable loop state |
| `CLAUDE.md` | Modify — add the Effect grounding rule |
| `package.json` | Modify — add `test` script |
| `apps/api/package.json` | Modify — pinned deps + `test` script |
| `vitest.config.ts` | Create — workspace test config |
| `apps/api/src/errors/index.ts` | Create — tagged error taxonomy |
| `apps/api/src/layers/database.ts` | Create — Drizzle boundary, maps rejections to `DbError` |
| `apps/api/src/layers/telegram.ts` | Create — grammY boundary; breaks the service→bot cycle |
| `apps/api/src/runtime/index.ts` | Create — `ManagedRuntime`, `AppLayer`, `runRoute` seam |
| `apps/api/src/services/members.service.ts` | Rewrite — `MembersService` as `Context.Service` |
| `apps/api/src/routes/members.ts` | Modify — route handlers call the seam |

---

### Task 1.1: Loop state and Effect grounding

**Files:**
- Create: `docs/superpowers/plans/STATE.md`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Create the state file**

```markdown
# Effect v4 Migration — State

status: RUNNING
current_phase: 1
blocked_total: 0
blocked_streak: 0

## Log
```

- [ ] **Step 2: Append the Effect grounding rule to `CLAUDE.md`**

Add this section at the end of `CLAUDE.md`:

```markdown
## Effect v4

This project uses Effect **v4** (`4.0.0-rc.111`), pinned exactly.

**Before writing any Effect code, read `node_modules/effect/CLAUDE.md` and the
relevant topic under `node_modules/effect/ai-docs/src/`.** Model training data is
Effect v3, which differs substantially. Known renames:

| v3 (wrong here) | v4 (correct) |
| --- | --- |
| `@effect/schema` | `effect/Schema` |
| `@effect/platform` / `@effect/sql` / `@effect/ai` | `effect/unstable/{http,sql,ai}` |
| `Context.Tag` | `Context.Service<Self, Shape>()("id")` |
| `Data.TaggedError` | `Schema.TaggedError<E>()("Tag", {...})` |
| `Either` | `Result` |
| `Schedule.both` / `Schedule.intersect` | `Schedule.min([...])` + `Schedule.while` |
| `Effect.forkDaemon` | `Effect.forkDetach` |
| `Schema.decodeUnknown` | `Schema.decodeUnknownEffect` |

Do not consult effect.website or blog posts — `node_modules/effect/` is
version-matched to the pinned release by construction.

Never widen `effect`, `@effect/ai-anthropic`, or `@effect/vitest` to a range.
All three release in lockstep and must share one exact version.
```

- [ ] **Step 3: Verify the gate is green before starting**

Run: `bun test && bun run type-check && bun lint`
Expected: tests pass (474+ across 28+ files), type-check clean, lint clean.

If red, HALT — something outside this plan is broken.

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/plans/STATE.md CLAUDE.md
git commit -m "docs: add Effect v4 migration loop state and agent grounding rule

Agents default to Effect v3 from training data. Point them at the
version-matched docs shipped inside node_modules/effect instead."
```

---

### Task 1.2: Pin dependencies and switch to vitest

**Files:**
- Modify: `apps/api/package.json`
- Modify: `package.json`
- Create: `vitest.config.ts`

- [ ] **Step 1: Install exact-pinned dependencies**

```bash
cd apps/api
bun add effect@4.0.0-rc.111 --exact
bun add -d @effect/vitest@4.0.0-rc.111 vitest@^3 --exact
```

Verify no carets were written:

Run: `node -e "const p=require('./package.json');console.log(p.dependencies.effect, p.devDependencies['@effect/vitest'])"`
Expected: `4.0.0-rc.111 4.0.0-rc.111` — no `^` or `~`.

- [ ] **Step 2: Create `vitest.config.ts` at the repo root**

```ts
import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    include: ["apps/api/src/**/*.test.ts", "packages/**/src/**/*.test.ts"],
    globals: false,
    testTimeout: 15_000,
  },
})
```

- [ ] **Step 3: Add `test` scripts**

In root `package.json` `scripts`, add:

```json
"test": "vitest run",
"test:watch": "vitest"
```

In `apps/api/package.json` `scripts`, add:

```json
"test": "vitest run --root ../.."
```

- [ ] **Step 4: Verify vitest runs (tests will still fail — they import `bun:test`)**

Run: `bun run test`
Expected: vitest starts and reports failures about `bun:test` being unresolvable. This confirms vitest is wired but the port has not happened yet.

- [ ] **Step 5: Commit**

```bash
git add package.json apps/api/package.json vitest.config.ts bun.lock
git commit -m "build: pin Effect v4 and add vitest alongside bun:test

Effect, @effect/vitest and @effect/ai-anthropic release in lockstep and
are pinned exactly; the RC moves fast and upgrades must be deliberate."
```

---

### Task 1.3: Port all existing tests to vitest

**Files:**
- Modify: every `apps/api/src/**/*.test.ts`

- [ ] **Step 1: Count the files to port, so the result can be checked**

```bash
find apps/api/src -name "*.test.ts" | wc -l
find apps/api/src -name "*.test.ts" -exec grep -l 'from "bun:test"' {} + | wc -l
```

Record both numbers. They should be equal.

- [ ] **Step 2: Rewrite the imports**

`bun:test` and `vitest` expose the same names used in this repo (`describe`, `test`, `expect`, `beforeEach`, `spyOn`), so this is a one-line substitution per file:

```bash
find apps/api/src -name "*.test.ts" -exec \
  perl -pi -e 's{from "bun:test"}{from "vitest"}g' {} +
```

- [ ] **Step 3: Fix `spyOn`, which vitest exposes via `vi`**

`apps/api/src/bot/ai/context.test.ts` imports `spyOn`. In vitest that is `vi.spyOn`. Change the import to include `vi` and replace bare `spyOn(` with `vi.spyOn(`:

```bash
perl -pi -e 's{import \{ describe, expect, spyOn, test \} from "vitest"}{import \{ describe, expect, test, vi \} from "vitest"}g; s{\bspyOn\(}{vi.spyOn(}g' \
  apps/api/src/bot/ai/context.test.ts
```

- [ ] **Step 4: Run the suite**

Run: `bun run test`
Expected: all tests pass. The count must match the pre-port baseline (474+ tests). If any test fails, fix it — do not delete or skip it.

Snapshot note: two snapshot assertions exist under `apps/api/src/bot/ai/__snapshots__/`. Vitest's snapshot format differs from bun's. If snapshots fail, inspect the diff first; only run `bun run test -- -u` if the diff is purely formatting.

- [ ] **Step 5: Verify no `bun:test` imports remain**

Run: `rg -l 'from "bun:test"' apps/api/src | wc -l`
Expected: `0`

- [ ] **Step 6: Commit**

```bash
git add apps/api/src
git commit -m "test: port suite from bun:test to vitest

@effect/vitest provides it.effect, it.layer and TestClock, which the
Effect migration needs for testing retries and layered services."
```

---

### Task 1.4: Error taxonomy

**Files:**
- Create: `apps/api/src/errors/index.ts`
- Test: `apps/api/src/errors/errors.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, test } from "vitest"
import { DbError, MemberNotFound, TelegramError } from "./index"

describe("error taxonomy", () => {
  test("errors carry structured fields, not formatted strings", () => {
    const e = new MemberNotFound({ userId: "u1" })
    expect(e._tag).toBe("MemberNotFound")
    expect(e.userId).toBe("u1")
  })

  test("DbError records which operation failed", () => {
    const e = new DbError({ operation: "members.list", cause: new Error("boom") })
    expect(e._tag).toBe("DbError")
    expect(e.operation).toBe("members.list")
  })

  test("TelegramError carries retryability as data, not a message regex", () => {
    const e = new TelegramError({ operation: "ban", retryable: true, cause: new Error("429") })
    expect(e.retryable).toBe(true)
  })
})
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `bun run test -- apps/api/src/errors/errors.test.ts`
Expected: FAIL — cannot resolve `./index`.

- [ ] **Step 3: Implement the taxonomy**

```ts
/**
 * Tagged error taxonomy. Replaces the single stringly-typed AppError.
 *
 * Errors carry structured fields so policy can be a property of the error
 * (see TelegramError.retryable) rather than a regex over its message, which
 * is what lib/retry.ts does today.
 *
 * Services must NOT reference HTTP status codes. Status mapping belongs
 * exclusively to the seam in runtime/index.ts.
 */
import { Schema } from "effect"

// --- infrastructure ---
export class DbError extends Schema.TaggedError<DbError>()("DbError", {
  operation: Schema.String,
  cause: Schema.Defect(),
}) {}

export class HttpError extends Schema.TaggedError<HttpError>()("HttpError", {
  url: Schema.String,
  status: Schema.optional(Schema.Number),
  retryable: Schema.Boolean,
  cause: Schema.Defect(),
}) {}

export class TelegramError extends Schema.TaggedError<TelegramError>()("TelegramError", {
  operation: Schema.String,
  retryable: Schema.Boolean,
  cause: Schema.Defect(),
}) {}

// --- domain ---
export class MemberNotFound extends Schema.TaggedError<MemberNotFound>()("MemberNotFound", {
  userId: Schema.String,
}) {}

export class InsufficientRole extends Schema.TaggedError<InsufficientRole>()("InsufficientRole", {
  required: Schema.String,
  actual: Schema.String,
}) {}

export class AlreadyInState extends Schema.TaggedError<AlreadyInState>()("AlreadyInState", {
  entity: Schema.String,
  state: Schema.String,
}) {}

export class SelfTargeted extends Schema.TaggedError<SelfTargeted>()("SelfTargeted", {
  action: Schema.String,
}) {}
```

- [ ] **Step 4: Run the test**

Run: `bun run test -- apps/api/src/errors/errors.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/errors
git commit -m "feat: add tagged error taxonomy for Effect migration

Replaces the single AppError class. Errors carry structured fields so
retry policy reads error.retryable instead of regexing a message string."
```

---

### Task 1.5: Database layer

**Files:**
- Create: `apps/api/src/layers/database.ts`
- Test: `apps/api/src/layers/database.test.ts`

The `Database` service deliberately does **not** re-implement Drizzle's query surface. It wraps the *boundary*: one `use` helper that maps any rejection to a typed `DbError`. Domain services depend on `Database` and expose their own methods.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "@effect/vitest"
import { Effect, Layer } from "effect"
import { Database } from "./database"
import { DbError } from "../errors"

// A stub layer standing in for a real connection.
const stub = Layer.succeed(Database)(
  Database.of({
    use: (operation, fn) =>
      Effect.tryPromise({
        try: () => fn({ marker: "fake-db" } as never),
        catch: (cause) => new DbError({ operation, cause }),
      }),
  }),
)

describe("Database", () => {
  it.effect("passes the drizzle client to the callback", () =>
    Effect.gen(function*() {
      const db = yield* Database
      const out = yield* db.use("test.ok", async (d) => (d as unknown as { marker: string }).marker)
      expect(out).toBe("fake-db")
    }).pipe(Effect.provide(stub)))

  it.effect("maps a rejection to a tagged DbError carrying the operation", () =>
    Effect.gen(function*() {
      const db = yield* Database
      const result = yield* Effect.result(
        db.use("test.boom", () => Promise.reject(new Error("connection lost"))),
      )
      expect(result._tag).toBe("Failure")
      if (result._tag === "Failure") {
        expect(result.failure._tag).toBe("DbError")
        expect(result.failure.operation).toBe("test.boom")
      }
    }).pipe(Effect.provide(stub)))
})
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `bun run test -- apps/api/src/layers/database.test.ts`
Expected: FAIL — cannot resolve `./database`.

- [ ] **Step 3: Implement the layer**

```ts
/**
 * Drizzle boundary as an Effect service.
 *
 * Deliberately thin: `use` wraps a drizzle call and maps rejection to a typed
 * DbError. Re-implementing drizzle's query surface as service methods would be
 * enormous and buy nothing — DI belongs at the domain-service boundary, which
 * is where tests want to stub.
 */
import { Context, Effect, Layer } from "effect"
import { drizzle } from "drizzle-orm/postgres-js"
import postgres from "postgres"
import * as schema from "../db/schema"
import { DbError } from "../errors"

export type DrizzleDb = ReturnType<typeof drizzle<typeof schema>>

export class Database extends Context.Service<Database, {
  readonly use: <A>(
    operation: string,
    fn: (db: DrizzleDb) => Promise<A>,
  ) => Effect.Effect<A, DbError>
}>()("api/db/Database") {
  static readonly layer = Layer.effect(
    Database,
    Effect.gen(function*() {
      const url = process.env.DATABASE_URL
      if (url === undefined) {
        return yield* Effect.die(new Error("DATABASE_URL is not set"))
      }

      const client = postgres(url)
      const db = drizzle(client, { schema })

      // Release the pool when the layer's scope closes.
      yield* Effect.addFinalizer(() => Effect.promise(() => client.end()))

      return Database.of({
        use: (operation, fn) =>
          Effect.tryPromise({
            try: () => fn(db),
            catch: (cause) => new DbError({ operation, cause }),
          }),
      })
    }),
  )
}
```

- [ ] **Step 4: Run the test**

Run: `bun run test -- apps/api/src/layers/database.test.ts`
Expected: PASS, 2 tests. **This is the first test in this repo that exercises a service boundary against a stub** — a capability that did not previously exist.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/layers/database.ts apps/api/src/layers/database.test.ts
git commit -m "feat: add Database layer wrapping the drizzle boundary

Services stop importing the db singleton. The layer wraps the boundary
rather than drizzle's query surface, keeping DI at the service level."
```

---

### Task 1.6: Telegram layer

**Files:**
- Create: `apps/api/src/layers/telegram.ts`
- Test: `apps/api/src/layers/telegram.test.ts`

This removes the `import { bot } from "../bot/bot"` at `apps/api/src/services/members.service.ts:6` — a service reaching into the presentation layer, inverting the boundary ADR-005 established.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { Telegram } from "./telegram"

describe("Telegram", () => {
  it.effect("marks API failures as retryable", () =>
    Effect.gen(function*() {
      const tg = yield* Telegram
      const result = yield* Effect.result(tg.ban("chat-1", 42))
      expect(result._tag).toBe("Failure")
      if (result._tag === "Failure") {
        expect(result.failure._tag).toBe("TelegramError")
        expect(result.failure.retryable).toBe(true)
        expect(result.failure.operation).toBe("ban")
      }
    }).pipe(
      Effect.provide(
        Telegram.make({
          banChatMember: () => Promise.reject(new Error("429 Too Many Requests")),
          unbanChatMember: () => Promise.resolve(true as const),
        }),
      ),
    ))

  it.effect("succeeds when the API succeeds", () =>
    Effect.gen(function*() {
      const tg = yield* Telegram
      yield* tg.unban("chat-1", 42)
    }).pipe(
      Effect.provide(
        Telegram.make({
          banChatMember: () => Promise.resolve(true as const),
          unbanChatMember: () => Promise.resolve(true as const),
        }),
      ),
    ))
})
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `bun run test -- apps/api/src/layers/telegram.test.ts`
Expected: FAIL — cannot resolve `./telegram`.

- [ ] **Step 3: Implement the layer**

```ts
/**
 * grammY boundary as an Effect service.
 *
 * Exists so services never import the bot singleton. Telegram API failures are
 * transient far more often than not, so they are marked retryable and handled
 * by a Schedule at the call site rather than swallowed by .catch(console.error).
 */
import { Context, Effect, Layer } from "effect"
import { TelegramError } from "../errors"

export interface BotApi {
  banChatMember(chatId: string, userId: number): Promise<true>
  unbanChatMember(chatId: string, userId: number): Promise<true>
}

export class Telegram extends Context.Service<Telegram, {
  readonly ban: (chatId: string, tgId: number) => Effect.Effect<void, TelegramError>
  readonly unban: (chatId: string, tgId: number) => Effect.Effect<void, TelegramError>
}>()("api/bot/Telegram") {
  static readonly make = (api: BotApi) =>
    Layer.succeed(Telegram)(
      Telegram.of({
        ban: (chatId, tgId) =>
          Effect.tryPromise({
            try: () => api.banChatMember(chatId, tgId).then(() => undefined),
            catch: (cause) => new TelegramError({ operation: "ban", retryable: true, cause }),
          }),
        unban: (chatId, tgId) =>
          Effect.tryPromise({
            try: () => api.unbanChatMember(chatId, tgId).then(() => undefined),
            catch: (cause) => new TelegramError({ operation: "unban", retryable: true, cause }),
          }),
      }),
    )

  /** Wires the real grammY bot. Used by runtime/index.ts only. */
  static readonly layer = Layer.unwrap(
    Effect.promise(async () => {
      const { bot } = await import("../bot/bot")
      return Telegram.make(bot.api as unknown as BotApi)
    }),
  )
}
```

- [ ] **Step 4: Run the test**

Run: `bun run test -- apps/api/src/layers/telegram.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/layers/telegram.ts apps/api/src/layers/telegram.test.ts
git commit -m "feat: add Telegram layer to break the service to bot import cycle

members.service.ts imported the grammY bot singleton directly, inverting
the boundary ADR-005 set. Services now depend on an interface instead."
```

---

### Task 1.7: Runtime seam

**Files:**
- Create: `apps/api/src/runtime/index.ts`
- Test: `apps/api/src/runtime/runtime.test.ts`

This is the most important file in the migration. `runRoute` requires `E = never`, so **a route with an unmapped domain error cannot compile**.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { toRouteResult } from "./index"
import { MemberNotFound } from "../errors"

describe("route seam", () => {
  it.effect("wraps a success value as 200", () =>
    Effect.gen(function*() {
      const out = yield* toRouteResult(Effect.succeed({ id: "u1" }))
      expect(out).toEqual({ status: 200, body: { id: "u1" } })
    }))

  it.effect("passes an already-mapped result through unchanged", () =>
    Effect.gen(function*() {
      const mapped = Effect.succeed({ status: 404, body: { code: "NOT_FOUND" } })
      const out = yield* toRouteResult(mapped)
      expect(out).toEqual({ status: 404, body: { code: "NOT_FOUND" } })
    }))

  it.effect("a mapped domain error yields its status", () =>
    Effect.gen(function*() {
      const handled = Effect.fail(new MemberNotFound({ userId: "u1" })).pipe(
        Effect.catchTags({
          MemberNotFound: (e) =>
            Effect.succeed({ status: 404, body: { code: "NOT_FOUND", userId: e.userId } }),
        }),
      )
      const out = yield* toRouteResult(handled)
      expect(out.status).toBe(404)
    }))
})
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `bun run test -- apps/api/src/runtime/runtime.test.ts`
Expected: FAIL — cannot resolve `./index`.

- [ ] **Step 3: Implement the seam**

```ts
/**
 * The seam between Effect and the Elysia / grammY edges.
 *
 * runRoute requires E = never. That single constraint is what makes unhandled
 * domain errors impossible rather than merely discouraged: a route that forgets
 * a catchTags arm fails to compile with
 *   "Type 'DbError' is not assignable to type 'never'".
 *
 * Handlers return the SAME plain objects they return today, so `typeof app`
 * is unchanged and Eden Treaty inference into apps/web is unaffected.
 */
import { Effect, Layer, ManagedRuntime } from "effect"
import { Database } from "../layers/database"
import { Telegram } from "../layers/telegram"
import { MembersService } from "../services/members.service"

export const AppLayer = Layer.mergeAll(
  Database.layer,
  Telegram.layer,
  MembersService.layer.pipe(Layer.provide(Database.layer)),
)

// v4 flattens this helper: `Layer.Success`, NOT v3's `Layer.Layer.Success`.
export type AppServices = Layer.Success<typeof AppLayer>

export const runtime = ManagedRuntime.make(AppLayer)

export type RouteResult = { status: number; body: unknown }

/** Normalises a handled effect into a RouteResult. */
export const toRouteResult = <A>(
  effect: Effect.Effect<A, never, never>,
): Effect.Effect<RouteResult, never, never> =>
  effect.pipe(
    Effect.map((value): RouteResult =>
      typeof value === "object" && value !== null && "status" in value
        ? (value as RouteResult)
        : { status: 200, body: value }),
  )

/**
 * Run a fully-handled effect at the HTTP edge.
 * E is pinned to `never` on purpose — see the file comment.
 */
export const runRoute = <A>(
  effect: Effect.Effect<A, never, AppServices>,
): Promise<A> => runtime.runPromise(effect)

/**
 * Run a fully-handled effect at the Telegram edge.
 *
 * grammY handlers are `(ctx) => Promise<void>` and grammY's own error handler
 * should never see an Effect failure, so E is pinned to `never` here too.
 */
export const runHandler = (
  effect: Effect.Effect<unknown, never, AppServices>,
): Promise<void> => runtime.runPromise(effect).then(() => undefined)

/**
 * Fire-and-forget work that must not block the response but must still be
 * observable — the replacement for `.catch(console.error)`.
 */
export const runBackground = (
  effect: Effect.Effect<unknown, never, AppServices>,
): void => {
  runtime.runFork(Effect.forkDetach(effect))
}

/** Disposes the runtime, closing the Database layer's postgres pool. */
export const disposeRuntime = (): Promise<void> => runtime.dispose()
```

- [ ] **Step 4: Run the test**

Run: `bun run test -- apps/api/src/runtime/runtime.test.ts`
Expected: PASS, 3 tests.

Every API in this file has been verified against `effect@4.0.0-rc.111`:
`ManagedRuntime.make`, `.runPromise`, `.runFork`, `.dispose`, `Layer.Success`,
`Layer.mergeAll`, `Layer.provide`, `Effect.forkDetach`. Transcribe as written.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/runtime
git commit -m "feat: add ManagedRuntime seam between Effect and the Elysia edge

runRoute pins E to never so a route with an unmapped domain error fails
to compile. Handlers keep returning plain objects, so Eden Treaty
inference into apps/web is structurally unaffected."
```

---

### Task 1.8: MembersService as a Context.Service

**Files:**
- Rewrite: `apps/api/src/services/members.service.ts`
- Test: `apps/api/src/services/members.service.test.ts`

Read the current file first. Preserve **every** existing behaviour: the BM25 `@@@` search predicates, the ILIKE fallbacks on `user.name`/`user.telegramUsername`, pagination via `paginatedResult`/`listOffset`, the `photoUrlSql()` projection, and the distinct column sets in `findWithUser` (includes `aiSummary`) versus `findByUsername`/`list` (must not).

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "@effect/vitest"
import { Effect, Layer } from "effect"
import { Database } from "../layers/database"
import { DbError } from "../errors"
import { MembersService } from "./members.service"

const dbReturning = (rows: ReadonlyArray<unknown>) =>
  Layer.succeed(Database)(
    Database.of({ use: () => Effect.succeed(rows as never) }),
  )

const dbFailing = Layer.succeed(Database)(
  Database.of({
    use: (operation) =>
      Effect.fail(new DbError({ operation, cause: new Error("down") })),
  }),
)

const withDb = (layer: Layer.Layer<Database>) =>
  MembersService.layer.pipe(Layer.provide(layer))

describe("MembersService", () => {
  it.effect("findByUserId returns null when no row matches", () =>
    Effect.gen(function*() {
      const members = yield* MembersService
      expect(yield* members.findByUserId("nobody")).toBeNull()
    }).pipe(Effect.provide(withDb(dbReturning([])))))

  it.effect("requireByUserId fails with MemberNotFound when absent", () =>
    Effect.gen(function*() {
      const members = yield* MembersService
      const r = yield* Effect.result(members.requireByUserId("nobody"))
      expect(r._tag).toBe("Failure")
      if (r._tag === "Failure") expect(r.failure._tag).toBe("MemberNotFound")
    }).pipe(Effect.provide(withDb(dbReturning([])))))

  it.effect("database failure surfaces as DbError, not a thrown exception", () =>
    Effect.gen(function*() {
      const members = yield* MembersService
      const r = yield* Effect.result(members.findByUserId("u1"))
      expect(r._tag).toBe("Failure")
      if (r._tag === "Failure") expect(r.failure._tag).toBe("DbError")
    }).pipe(Effect.provide(withDb(dbFailing))))
})
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `bun run test -- apps/api/src/services/members.service.test.ts`
Expected: FAIL — `MembersService` is not exported.

- [ ] **Step 3: Rewrite the service**

Convert each method on the existing `membersService` object literal into an `Effect.fn` inside the layer. The shape, using `ban` as the worked example — apply the same transformation to `findByUserId`, `list`, `update`, `create`, `createIfNotExists`, `findWithUser`, `findByUsername`, `unban`, and `changeRole`:

```ts
import { Context, Effect, Layer } from "effect"
import { eq } from "drizzle-orm"
import { Database } from "../layers/database"
import { DbError, MemberNotFound } from "../errors"
import { user } from "../db/schema/auth"

export class MembersService extends Context.Service<MembersService, {
  readonly findByUserId: (userId: string) =>
    Effect.Effect<typeof user.$inferSelect | null, DbError>
  readonly requireByUserId: (userId: string) =>
    Effect.Effect<typeof user.$inferSelect, DbError | MemberNotFound>
  readonly ban: (userId: string) =>
    Effect.Effect<typeof user.$inferSelect, DbError | MemberNotFound>
  // ...one entry per preserved method
}>()("api/services/MembersService") {
  static readonly layer = Layer.effect(
    MembersService,
    Effect.gen(function*() {
      const db = yield* Database

      const findByUserId = Effect.fn("MembersService.findByUserId")(
        function*(userId: string) {
          const rows = yield* db.use("members.findByUserId", (d) =>
            d.select().from(user).where(eq(user.id, userId)).limit(1))
          return rows[0] ?? null
        },
      )

      const requireByUserId = Effect.fn("MembersService.requireByUserId")(
        function*(userId: string) {
          const found = yield* findByUserId(userId)
          if (found === null) return yield* new MemberNotFound({ userId })
          return found
        },
      )

      const ban = Effect.fn("MembersService.ban")(function*(userId: string) {
        yield* requireByUserId(userId)
        const rows = yield* db.use("members.ban", (d) =>
          d.update(user)
            .set({ banned: true, updatedAt: new Date() })
            .where(eq(user.id, userId))
            .returning())
        const updated = rows[0]
        if (updated === undefined) return yield* new MemberNotFound({ userId })
        return updated
      })

      return MembersService.of({ findByUserId, requireByUserId, ban /* ...*/ })
    }),
  )
}
```

Two rules while transforming:

1. **The Telegram side-effect moves out of `ban`/`unban`.** Today `members.service.ts:263-267` calls `bot.api.banChatMember(...).catch(console.error)`. The service must no longer know about Telegram; the route composes `MembersService.ban` with `Telegram.ban`. Task 1.9 wires this.
2. `noUncheckedIndexedAccess` is enabled — `rows[0]` is `T | undefined`. Handle it explicitly, as above. Never use `!`.

- [ ] **Step 4: Run the test**

Run: `bun run test -- apps/api/src/services/members.service.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Verify the bot import is gone**

Run: `rg -n 'from "../bot/bot"' apps/api/src/services/members.service.ts`
Expected: no matches.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/services/members.service.ts apps/api/src/services/members.service.test.ts
git commit -m "refactor: convert members service to an Effect Context.Service

Failure modes now appear in the type signature, the db and bot singleton
imports are gone, and the service is testable against a stub Database."
```

---

### Task 1.9: Wire the members route through the seam

**Files:**
- Modify: `apps/api/src/routes/members.ts`
- Modify: `package.json` (extend the gate)

- [ ] **Step 1: Rewrite each handler to call the seam**

Every handler keeps its Elysia signature and returns the same shape as before. `PATCH /:userId/ban` is the worked example; apply the same pattern to the other six handlers.

```ts
.patch(
  "/:userId/ban",
  async ({ params: { userId }, user, body, set }) => {
    const result = await runRoute(
      Effect.gen(function*() {
        const members = yield* MembersService
        const tg = yield* Telegram

        if (userId === user.id) {
          return yield* new SelfTargeted({ action: "ban" })
        }

        const target = yield* members.requireByUserId(userId)

        const callerLevel = ROLE_HIERARCHY[user.role as Role] ?? 0
        const targetLevel = ROLE_HIERARCHY[target.role as Role] ?? 0
        if (targetLevel >= callerLevel) {
          return yield* new InsufficientRole({
            required: "higher than target",
            actual: user.role,
          })
        }
        if (target.banned) {
          return yield* new AlreadyInState({ entity: "member", state: "banned" })
        }

        const updated = yield* members.ban(userId)

        // Previously bot.api.banChatMember(...).catch(console.error) inside the
        // service. Now explicit, retried, and logged rather than swallowed.
        if (updated.telegramId !== null && env.TELEGRAM_GROUP_ID !== undefined) {
          yield* tg.ban(env.TELEGRAM_GROUP_ID, Number(updated.telegramId)).pipe(
            Effect.catchTag("TelegramError", (e) =>
              Effect.logError("telegram ban failed", e)),
          )
        }

        runBackground(
          Effect.promise(() =>
            createAuditEntry({
              entityType: "member",
              entityId: userId,
              action: "ban",
              newValue: { banned: true, reason: body.reason },
              performedBy: user.id,
            })),
        )

        return updated
      }).pipe(
        Effect.catchTags({
          MemberNotFound: () =>
            Effect.succeed({ status: 404, body: { message: "Member not found" } }),
          SelfTargeted: () =>
            Effect.succeed({ status: 403, body: { message: "Cannot ban yourself" } }),
          InsufficientRole: () =>
            Effect.succeed({
              status: 403,
              body: { message: "Cannot ban a user with equal or higher role" },
            }),
          AlreadyInState: () =>
            Effect.succeed({ status: 409, body: { message: "User is already banned" } }),
          DbError: (e) =>
            Effect.logError("db failure", e).pipe(
              Effect.as({ status: 500, body: { message: "Internal server error" } })),
        }),
        toRouteResult,
      ),
    )
    set.status = result.status
    return result.body
  },
  { /* auth, beforeHandle, body, detail unchanged */ },
)
```

**The response bodies and status codes must match the current implementation exactly** — `"Member not found"`, `"Cannot ban yourself"`, `"Cannot ban a user with equal or higher role"`, `"User is already banned"`. `apps/web` consumes these.

- [ ] **Step 2: Verify the Eden Treaty invariant holds**

Run: `bun run --cwd apps/web type-check`
Expected: PASS with `apps/web` unmodified. If this fails, the route's return type changed — fix the route, never `apps/web`.

- [ ] **Step 3: Add the Eden invariant to the gate permanently**

In root `package.json`, change the `type-check` script so the web check can never be skipped:

```json
"type-check": "bun run --filter '*' type-check"
```

Confirm it already covers `apps/web` (it uses `--filter '*'`). If it does, no change is needed — record that and move on.

- [ ] **Step 4: Run the full gate**

Run: `bun run test && bun run type-check && bun lint`
Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/members.ts package.json
git commit -m "refactor: run members routes through the Effect seam

Status codes and response bodies are byte-identical, so Eden Treaty
types in apps/web are unchanged. Audit writes and Telegram calls that
were fire-and-forget .catch(console.error) are now supervised."
```

---

### Task 1.10: Phase gate

- [ ] **Step 1: Confirm the whole suite and both type-checks pass**

Run: `bun run test && bun run type-check && bun lint`
Expected: green.

- [ ] **Step 2: Confirm the app still boots**

Run: `bun run --cwd apps/api build`
Expected: build succeeds.

- [ ] **Step 3: Record phase completion**

Append to `docs/superpowers/plans/STATE.md`:

```
<iso-date> PHASE 1 COMPLETE
```

Set `current_phase: 2`.

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/plans/STATE.md
git commit -m "chore: mark Effect migration phase 1 complete"
```

---

## Phase 1 exit criteria

- `effect`, `@effect/vitest` pinned exactly at `4.0.0-rc.111`, no ranges.
- Zero `from "bun:test"` imports remain; full suite green under vitest.
- `errors/`, `layers/database.ts`, `layers/telegram.ts`, `runtime/index.ts` exist and are tested.
- `members.service.ts` imports neither `../db` nor `../bot/bot`.
- At least three tests run a service against a stub `Database` layer.
- `apps/web` type-checks **unmodified**.

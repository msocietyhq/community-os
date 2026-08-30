# OpenAI Provider and Credit-Exhaustion Fallback

**Date:** 2026-08-30
**Status:** Approved, ready for planning

## Problem

Two problems, one design.

**The bot runs on two providers.** `AI_PROVIDERS` is `["anthropic", "deepseek"]`.
Every tier default is Anthropic. Adding OpenAI widens the choice for admins and,
more importantly, gives the fallback below somewhere to go.

**A provider running out of prepaid credit takes the bot down.** Each provider is
funded by a separate prepaid balance. When one empties, every call routed to it
fails: `trackedGenerateText` throws, the member sees an error, and the crons stop.
Nothing detects the condition, nothing routes around it, and nobody is told. The
first sign is a member reporting that the bot is broken.

The two are related: a fallback needs a third provider to be worth much, and a
third provider is most useful as a fallback.

## Goals

- OpenAI is a first-class provider: selectable per tier, correctly priced, and
  usable as a fallback target.
- When a provider's credit runs out, members keep getting answers. The in-flight
  call is retried on a working model rather than surfacing as an error.
- Admins are told once, promptly, in a DM that says which tiers are affected and
  lets them choose deliberate replacements.
- A provider that gets topped up returns to service on its own, without anyone
  editing anything, and without the admin's original model choice having been
  destroyed in the meantime.

**Non-goals:**

- **Tracking prepaid balances.** Considered and rejected: the same API keys are
  used outside the bot, so `ai_usage` can only ever see part of the spend. A
  balance derived from it would be confidently wrong. The provider's own error
  is the only trustworthy signal, so it is the only signal used.
- **Handling rate limits or outages.** Only credit exhaustion is in scope.
  `lib/retry.ts` already covers 429s and 5xx, and conflating a transient 429
  with an empty account would take a healthy provider out of rotation.
- **A web surface.** Everything is Telegram DM plus the existing settings menu.

## Part A — OpenAI as a provider

### Catalog additions

`AI_PROVIDERS` gains `"openai"`. `env.ts` gains `OPENAI_API_KEY` as **optional** —
a deployment without it must still boot, matching `DEEPSEEK_API_KEY`.
`@ai-sdk/openai` (^4.0.52, current at time of writing) is added to `apps/api`.
`FACTORIES` in `ai-provider.ts` gains a lazy `openai` entry in the same shape as
the DeepSeek one, including the missing-key backstop throw.

Three models, one per tier band:

| Catalog key | modelId | input | output | cached input |
| --- | --- | --- | --- | --- |
| `openai/gpt-5.6-luna` | `gpt-5.6-luna` | $0.20 | $1.20 | $0.02 (0.1×) |
| `openai/gpt-5.6-terra` | `gpt-5.6-terra` | $2.00 | $12.00 | $0.20 (0.1×) |
| `openai/gpt-5.6-sol` | `gpt-5.6-sol` | $4.00 | $20.00 | $0.40 (0.1×) |

Pricing is per 1M tokens, verified against each model's own page under
`developers.openai.com/api/docs/models/` on 2026-08-30. Accuracy here is not
cosmetic: `estimateCost` prices every call from this table and every cost cap in
the system is computed from it, so a wrong number silently weakens the daily cap,
the monthly cap and the advisor budget while the bot carries on answering.

**Cache pricing is the Anthropic shape; cache *plumbing* is the DeepSeek shape.**
OpenAI bills a cache write at 1.25× the uncached input rate and a read at 0.1×,
so the entries are `cache: { read: 0.1, write: 1.25 }`. Copying DeepSeek's
`write: 1` would under-count every cache write by 25%, straight into the caps.

`cacheControl` is nevertheless `null`. On GPT-5.6+ both caching modes carry the
same 1.25×/0.1× pricing; implicit mode — the default with no provider options at
all — places breakpoints automatically, so there is nothing to send. Explicit
mode's only advantage is *suppressing* a write on a changing suffix, which is an
optimisation, not a requirement. Minimum cacheable prefix is 1,024 tokens.

`withPromptCaching` therefore takes its `cacheControl === null` early return and
adds nothing, exactly as it does for DeepSeek.

**Known follow-up, deliberately out of scope.** That early return also means the
helper's tool-loop-only gate does not apply to OpenAI: implicit caching writes on
one-shot calls too, at 1.25×, which is the surcharge the gate exists to avoid for
Anthropic. Suppressing it needs explicit mode with a breakpoint placed before the
volatile suffix, which needs verification of how `@ai-sdk/openai` emits
breakpoints. Accounting is correct either way — this is a cost optimisation to
revisit once OpenAI usage is real, not a correctness bug.

Verified against `@ai-sdk/openai@4.0.52`: `reasoningEffort` accepts `none`,
`minimal`, `low`, `medium`, `high`, `xhigh`, `max`; `promptCacheOptions` accepts
`{ mode: "explicit" | "implicit", ttl?: "30m" }`; and all three model IDs appear
in the provider's model-ID union.

All three models support structured outputs and tool calling, and carry a
1,050,000-token context window with 128,000 max output tokens.

Unlike DeepSeek, OpenAI has native structured outputs — confirmed on all three
model pages — so it is a legitimate target for the `micro` tier, the tier the
catalog currently pins to Anthropic precisely because DeepSeek's schema handling
is a prompt-level imitation.

### Operational note

OpenAI credit is org-wide. Setting a **project spend limit** on the service
account's project turns "the bot ran out of money" into a boundary chosen by the
admin rather than the whole organisation's balance draining. Recommended in the
runbook; not enforced by code.

## Part B — Credit-exhaustion fallback

### Detection

A new pure module classifies a thrown error:

```ts
classifyProviderError(error: unknown): "out_of_credit" | "other"
```

| Provider | Signal |
| --- | --- |
| Anthropic | HTTP 400, `invalid_request_error`, message contains `credit balance is too low` |
| OpenAI | HTTP 429, error code `insufficient_quota` |
| DeepSeek | HTTP 402, `Insufficient Balance` |

Only `out_of_credit` trips any of the machinery below. Everything else — 429
rate limits included — propagates unchanged to the existing retry and error
paths. The distinction between OpenAI's quota 429 and an ordinary throttling 429
is the error code, not the status, and the test suite pins both cases.

### Health state: the `provider_health` table

One row per provider:

| Column | Purpose |
| --- | --- |
| `provider` (PK) | `anthropic` \| `openai` \| `deepseek` |
| `state` | `healthy` \| `out_of_credit` |
| `down_since` | When the first 402/429/400 landed |
| `retry_after` | Earliest next probe |
| `failure_count` | Drives the backoff curve; reset on success |
| `notified_at` | Set when the outage DM is sent; the transition guard |

**Why a table and not module state.** Every other cooldown in this codebase is
an in-memory `Map` — the DM denial cooldown, the chime-in cooldown, the spend
counter — and each documents why that is acceptable. Here it is not. In-memory
state is wiped by every Railway deploy, so a multi-day outage would re-DM every
admin after each deploy. Durability is the whole point of `notified_at`. The
table is also shared across replicas, and gives `/usage` something to read.

### Resolution: substitution, not mutation

`pickModelKey` in `ai.service.ts` currently falls back to `DEFAULT_TIER_MODELS`
when the selected model's `envKey` is unset. That behaviour extends to cover a
provider marked `out_of_credit`:

```
selected model's provider healthy and keyed  →  selected model
otherwise                                    →  first healthy, keyed entry in
                                                TIER_FALLBACK_ORDER[tier]
```

`TIER_FALLBACK_ORDER` is a new table in the catalog: per tier, the tier default
first, then one model per remaining provider in the fixed preference order
`anthropic → openai → deepseek`.

| Tier | Fallback order |
| --- | --- |
| `micro` | `anthropic/haiku-4-5` → `openai/gpt-5.6-luna` |
| `fast` | `anthropic/haiku-4-5` → `openai/gpt-5.6-luna` → `deepseek/v4-flash` |
| `smart` | `anthropic/sonnet-5` → `openai/gpt-5.6-terra` → `deepseek/v4-pro` |
| `deep` | `anthropic/opus-5` → `openai/gpt-5.6-sol` → `deepseek/v4-pro` |

Its first entry is `DEFAULT_TIER_MODELS[tier]` by construction, so the ordinary
single-outage case is "fall back to the tier default" and the rest of the row
only matters when that provider is down too. `micro` has no DeepSeek entry for
the reason the catalog already documents: it is entirely `generateObject`, and
DeepSeek has no native JSON-schema mode.

This table decides only the *interim*. It exists so a double outage has a
deterministic answer at 3am, not to make the model choice — that stays with the
admin, who is asked for one in the same minute.

**The settings row is never rewritten.** A tier set to `deepseek/v4-pro` still
reads `deepseek/v4-pro` in `/settings` while DeepSeek is down; only the
resolution changes. This matters on recovery: the admin's original choice is
still there and simply starts being honoured again, with nothing to restore and
no undo to get wrong. Overwriting the setting would destroy the very information
needed to put things back.

The outage is recorded once in the audit trail as its own event —
`entityType: "ai_provider"`, `entityId` the provider, `performedBy: "system"`,
with the affected tiers and what each resolved to — rather than as a fake
settings change. An admin choosing a replacement from the DM writes the setting
through the normal `setSetting` path, attributed to them, exactly as a menu edit
is today.

### Failover on the in-flight call

`trackedGenerateText` and `trackedGenerateObject` gain one retry:

1. Budget gate runs once, as today. It is not re-evaluated per attempt.
2. Resolve the tier, call the model.
3. On a thrown error, classify it. Not `out_of_credit` → rethrow unchanged.
4. `out_of_credit` → mark the provider down (first transition also queues the
   admin DM), re-resolve the tier, call again on the substituted model.
5. Both attempts are written to `ai_usage`, the first with `success: false` and
   the classified reason, so the outage is visible in usage history.
6. Nothing left to try → throw, as today.

One retry, not a loop over a chain. The second resolution already accounts for
every provider marked down, so a second failure means the substitute is also
empty — a case rare enough that failing loudly beats cascading.

### Recovery

`retry_after` follows exponential backoff from `failure_count`:
**30m → 1h → 2h → 4h → 8h → 24h**, capped.

Recovery needs no scheduler. Once `retry_after` has passed, `pickModelKey` stops
substituting and returns the admin's original selection, so the next call that
wants that tier probes the provider naturally:

- Probe succeeds → `state: healthy`, `failure_count: 0`, one recovery DM.
- Probe fails → `failure_count + 1`, next backoff step, **silent**. A retry that
  fails at 03:00 is not news.

Because the probe rides on a real call, a provider that no tier currently selects
is never probed and stays marked down indefinitely. That is correct rather than a
bug: nothing routes to it, so its state is unobservable until someone selects it
again, and the first call after that selection is the probe. The consequence for
notifications is spelled out below.

30 minutes is deliberate for the first step and 24 hours for the cap: a top-up
within the hour is picked up quickly, while an outage nobody acts on costs about
three wasted round trips a day rather than 48.

### Notifications

A new `bot/lib/provider-alert.ts`, reusing the admin-lookup query from
`spend-alert.ts`. Kept separate because `spend-alert.ts` is about the spend
threshold; combining them would make one file answer to two triggers.

**On the transition into `out_of_credit`** (guarded by `notified_at`, so exactly
once per outage):

```
⚠️ DeepSeek has run out of credits.

Affecting: fast (V4 Flash), smart (V4 Pro)
Running on Haiku 4.5 and Sonnet 5 for now.

Pick a replacement for each tier, or keep these.

[ fast ▾ ]  [ smart ▾ ]  [ Keep these ]
[ I topped up — retry now ]
```

The tier pickers reuse the existing settings-menu model chooser rather than
introducing a second one; choosing writes through `setSetting` and is audited as
that admin. **[Keep these]** dismisses without writing, leaving the substitution
in force and the original settings intact. **[I topped up — retry now]** clears
`retry_after` so the next call probes immediately instead of waiting out the
backoff.

**On recovery**, one DM naming only the tiers that still select the recovered
provider — which is exactly the set that just moved back:

```
✅ DeepSeek is back in rotation.
smart has returned to V4 Pro.
```

If an admin repointed a tier during the outage, that tier is not listed: the
setting now names another model, nothing moved, and claiming otherwise would be
wrong. If they repointed *every* affected tier, no call ever probes DeepSeek, so
there is no recovery event and no DM — the provider simply sits marked down until
someone selects it again. Silence is the honest outcome there; the admin already
resolved the situation by hand.

At most two DMs per outage, however long it lasts.

## Testing

Pure cores tested directly, thin gates left to integration, matching the
`dm-access` / `dm-gate` split already used throughout `bot/lib`.

| Unit | Cases |
| --- | --- |
| `classifyProviderError` | One real error fixture per provider; an ordinary 429 rate limit and a 500 must both classify as `other` |
| Backoff schedule | The 30m→24h curve from `failure_count`, including the cap and the reset |
| Tier resolution | Selected model when healthy; the tier default when its provider is down; the next `TIER_FALLBACK_ORDER` entry when the default's provider is also down; unkeyed providers excluded throughout; `micro` never resolves to DeepSeek; every provider down throws rather than returning an unusable model; the settings row never mutated in any case |
| Affected-tier report | Which tiers a given provider's outage touches, including pinned `micro` |

`provider_health` access is a thin service over one table and is exercised
through the resolution tests with an injected clock.

## Migration

One Drizzle migration creating `provider_health`, seeded with a `healthy` row per
provider. Generated with `drizzle-kit generate` and committed; applied on deploy
by Railway. No backfill — an empty or missing row reads as healthy.

## Rollout

The two parts are independently shippable and should ship in order:

1. **Part A** alone is inert: a third provider nobody has selected. Verifiable by
   pointing one tier at an OpenAI model and confirming `/models`, `/usage` costs
   and the reasoning knob behave.
2. **Part B** then has three providers to work with. Testable in staging by
   pointing a tier at a deliberately unfunded key.

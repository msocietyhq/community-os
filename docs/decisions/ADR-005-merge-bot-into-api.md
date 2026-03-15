# ADR-005: Merge Bot into API

**Status**: accepted
**Date**: 2026-03-15
**Deciders**: Aziz

## Context

The Telegram bot (`apps/bot`) is a separate app that communicates with the API over HTTP via Eden Treaty. This adds deployment complexity — two services, two ports, separate auth, and a network hop — for no real benefit. The bot is tightly coupled to the API's domain logic (events, reputation, members, funds) and has no independent scaling needs.

Additionally, the bot's handlers currently contain TODOs for API calls that would be much simpler as direct service function calls.

## Decision

Merge `apps/bot` into `apps/api` under the `src/bot/` directory. The API process will:

1. Host the grammY bot instance
2. Expose a `/api/v1/bot/webhook` endpoint for Telegram webhook callbacks
3. Initialize the bot and register the webhook after the HTTP server starts listening

**Service-layer boundary rule**: Bot code must only call service functions (from `src/services/`). Bot code must **never** import from `src/db/` directly. This keeps the bot as a "presentation layer" — like routes, but for Telegram instead of HTTP.

## Consequences

### Positive
- Single deployment unit — one service, one port, one process
- No network hop between bot and API — direct function calls to services
- Shared auth context — no need for separate bot bearer tokens or API keys
- Simpler local development — `bun run --filter api dev` starts everything
- Easier to enforce consistent error handling and logging

### Negative
- Larger API process — bot dependencies (grammY, @anthropic-ai/sdk) are bundled in
- Bot crash could take down the API (mitigated by grammY's error handling)

### Neutral
- The monorepo now has 2 apps (`api`, `web`) instead of 3
- Bot-specific env vars (ANTHROPIC_API_KEY, WEBHOOK_URL, WEBHOOK_SECRET) move to the API's env config

## Alternatives Considered

### Option A: Keep bot as separate app, fix the Eden Treaty calls
- Pros: Independent deployment, process isolation
- Cons: Maintains all the complexity we're trying to eliminate; the bot has no independent scaling needs that justify the overhead

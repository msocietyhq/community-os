# ADR-003: Eden Treaty as Standard API Client

**Status**: accepted
**Date**: 2026-03-14
**Deciders**: Aziz

## Context

Both `apps/web` and `apps/bot` consume the community-os API. Currently both use manual fetch wrappers with no type safety — routes are passed as plain strings, and responses are untyped `any` values.

ElysiaJS was chosen specifically for Eden Treaty's end-to-end type safety (ADR-002), but that benefit is currently unrealized. The API already exports `type App = typeof app` in `apps/api/src/index.ts`, and both consumers have TODO comments indicating intent to switch.

## Decision

Use `@elysiajs/eden` treaty client in all apps that consume the API. Import the `App` type from `@community-os/api` for type inference. No codegen is needed — types flow directly from API route definitions to client calls at compile time.

Each consumer creates a treaty client configured for its environment:
- **Web**: `treaty<App>(window.location.origin)` — same-origin requests with cookie auth
- **Bot**: `treaty<App>(env.API_URL)` — server-to-server with bearer token auth

## Consequences

### Positive
- Compile-time type safety on all API calls (routes, params, request bodies, responses)
- IDE auto-complete for routes, parameters, and response types
- Breaking API changes are caught at build time across all consumers
- Eliminates manual fetch wrappers and their maintenance burden

### Negative
- Tighter coupling between consumers and ElysiaJS (acceptable since ADR-002 committed to ElysiaJS)
- Consumers must depend on `@community-os/api` as a workspace dependency for the `App` type

### Neutral
- Eden Treaty uses the same underlying `fetch` API — no runtime behavior change

## Alternatives Considered

### Option A: Keep manual fetch wrappers
- Pros: No additional dependencies, full control over request/response handling
- Cons: No type safety, duplicated boilerplate, easy to make typos in route paths

### Option B: OpenAPI codegen (e.g., openapi-typescript)
- Pros: Framework-agnostic, works with any OpenAPI-compliant API
- Cons: Requires codegen step, generated types can drift from runtime, adds build complexity

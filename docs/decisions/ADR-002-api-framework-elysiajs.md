# ADR-002: API Framework — ElysiaJS

**Status**: accepted
**Date**: 2026-03-14
**Deciders**: Aziz

## Context

We need a REST API framework for the community-os API server. The framework must:
- Run on Bun (our chosen runtime)
- Support end-to-end type safety with frontend clients
- Have good OpenAPI/Swagger documentation support
- Be performant and developer-friendly

## Decision

Use **ElysiaJS** as the API framework.

Key features that drove this decision:
- **Eden Treaty**: Generates a fully type-safe client from the API definition — no codegen needed. Both the web portal and bot consume the API through Eden Treaty.
- **Bun-native**: Built specifically for Bun, leveraging its performance characteristics.
- **OpenAPI**: First-class OpenAPI support via `@elysiajs/openapi` with Scalar UI.
- **Validation**: Built-in request/response validation with type inference.
- **Better Auth integration**: Official `.mount()` pattern for mounting Better Auth.

## Consequences

### Positive
- End-to-end type safety from DB → API → Client with zero codegen
- Auto-generated OpenAPI docs at `/openapi`
- Excellent Bun performance
- Clean plugin/middleware architecture

### Negative
- Smaller community than Express/Fastify
- Fewer middleware packages available (may need to write custom ones)
- Tightly coupled to Bun runtime (can't easily switch to Node.js)

### Neutral
- Learning curve for developers familiar with Express patterns

## Alternatives Considered

### Option A: Hono
- Pros: Multi-runtime (Bun, Node, Deno, Cloudflare Workers), large community
- Cons: No equivalent to Eden Treaty (would need separate codegen for type-safe clients)

### Option B: Fastify
- Pros: Mature, large ecosystem, good performance
- Cons: Node.js-first (Bun support is secondary), no Eden Treaty equivalent

### Option C: Express
- Pros: Largest ecosystem, most familiar
- Cons: Slowest option, no built-in type safety, middleware pattern is dated

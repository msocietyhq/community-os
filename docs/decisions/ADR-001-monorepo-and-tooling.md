# ADR-001: Monorepo Structure and Tooling

**Status**: accepted
**Date**: 2026-03-14
**Deciders**: Aziz

## Context

community-os consists of multiple applications (API, web portal, Telegram bot) that share types, validators, and constants. We need a project structure that enables code sharing while keeping deployments independent.

## Decision

Use a **Bun workspace monorepo** with the following structure:

- `apps/api` — ElysiaJS API server
- `apps/bot` — grammY Telegram bot
- `apps/web` — TanStack Router SPA
- `packages/shared` — Shared Zod validators, types, constants

**Tooling choices:**
- **Runtime**: Bun (fast, built-in TypeScript, built-in test runner, workspace support)
- **Package manager**: Bun (native workspace support, no need for pnpm/yarn)
- **Linting**: Biome (fast, replaces ESLint + Prettier)
- **No Turborepo**: The project is small enough that Bun workspaces alone suffice. Turborepo adds complexity we don't need yet.

## Consequences

### Positive
- Single `bun install` for all packages
- Shared types prevent API/client drift
- Bun's speed makes dev iteration fast
- Biome is significantly faster than ESLint + Prettier

### Negative
- Bun is newer than Node.js — some npm packages may have edge-case compatibility issues
- No build caching (would need Turborepo for that)

### Neutral
- Each app can be deployed independently on Railway

## Alternatives Considered

### Option A: Separate Repositories
- Pros: Fully independent, simpler CI
- Cons: No code sharing, type drift between API and clients, harder to maintain consistency

### Option B: pnpm Workspaces + Turborepo
- Pros: Build caching, established ecosystem
- Cons: Extra tooling complexity, pnpm adds another tool when Bun handles it natively

# ADR-004: TanStack Query for Client-Side Data Fetching

**Status**: accepted
**Date**: 2026-03-15
**Deciders**: Aziz

## Context

The web app uses Eden Treaty (ADR-003) for type-safe API calls. However, raw Eden calls inside `useEffect` + `useState` create boilerplate for loading states, error handling, caching, and refetching. Every component that fetches data re-implements the same pattern.

TanStack Query is a mature data-fetching library that handles caching, deduplication, background refetching, and loading/error states. Combined with Eden Treaty, it gives us type-safe API calls with automatic cache management — without writing manual fetch logic.

## Decision

Use `@tanstack/react-query` as the standard data-fetching layer in `apps/web`. Eden Treaty calls are used as the `queryFn` inside TanStack Query hooks.

**Pattern:**

```tsx
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api-client";

const { data, isLoading } = useQuery({
  queryKey: ["projects"],
  queryFn: () => api.api.v1.projects.get(),
});

// data is fully typed via Eden Treaty inference — no manual type definitions
```

**Setup:**

- `QueryClientProvider` wraps the app in `main.tsx`
- Response types are always inferred from Eden Treaty — never redefined on the client
- Query keys follow the convention `[resource]` or `[resource, id]`

## Consequences

### Positive
- Eliminates manual `useEffect` + `useState` fetch patterns
- Automatic caching, deduplication, and background refetching
- Types flow end-to-end from API → Eden Treaty → TanStack Query — no manual type definitions
- Consistent loading/error state handling across all components

### Negative
- Adds a runtime dependency (~13kB gzipped)
- Team must learn TanStack Query API conventions

### Neutral
- Eden Treaty remains the transport layer — TanStack Query wraps it, not replaces it

## Alternatives Considered

### Option A: Raw Eden Treaty with useEffect/useState
- Pros: No additional dependency, simple mental model
- Cons: Boilerplate for every fetch, no caching, no deduplication, manual loading/error states

### Option B: SWR
- Pros: Smaller bundle, simpler API
- Cons: Less feature-rich (no mutation tracking, weaker devtools), less ecosystem alignment with TanStack Router already in use

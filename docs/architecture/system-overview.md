# System Overview

**Status**: approved
**Last Updated**: 2026-03-14

## Overview

community-os is an API-first platform for managing the MSOCIETY community. It consists of three applications (API, Web Portal, Telegram Bot) backed by a shared PostgreSQL database on Neon.

## Architecture

```
┌─────────────┐     ┌──────────────┐     ┌──────────────┐
│   Web SPA   │     │ Telegram Bot │     │  Admin CLI   │
│ (TanStack)  │     │  (grammY)    │     │  (future)    │
└──────┬──────┘     └──────┬───────┘     └──────┬───────┘
       │ Eden Treaty       │ Eden Treaty        │
       └───────────┬───────┘────────────────────┘
                   ▼
          ┌────────────────┐
          │  ElysiaJS API  │
          │  (Bun runtime) │
          └────────┬───────┘
                   │ Drizzle ORM
                   ▼
          ┌────────────────┐
          │  PostgreSQL    │
          │  (Neon)        │
          └────────────────┘
```

## Components

### API Server (`apps/api`)
- **Runtime**: Bun
- **Framework**: ElysiaJS with OpenAPI docs
- **Auth**: Better Auth (Telegram Login + email/password)
- **ORM**: Drizzle ORM with postgres-js driver
- **Deployment**: Railway

The API is the single source of truth. All clients (web, bot, CLI) interact with the database exclusively through the API.

### Web Portal (`apps/web`)
- **Framework**: TanStack Router + React 19
- **Styling**: Tailwind CSS + shadcn/ui
- **API Client**: Eden Treaty (end-to-end type safety with ElysiaJS)
- **Deployment**: Railway (static site)
- **URL**: `hub.msociety.dev`

SPA with client-side routing. No SSR. Authenticated via Better Auth session cookies.

### Telegram Bot (`apps/bot`)
- **Framework**: grammY
- **AI**: Anthropic Claude SDK (tool-use agent)
- **API Client**: Eden Treaty
- **Deployment**: Railway

Replacement for the existing `msocietybot`. Handles reputation tracking, AI-powered community queries, event commands, and member onboarding.

### Shared Package (`packages/shared`)
- Zod validators shared between API and web
- TypeScript types derived from Drizzle schema
- Constants (roles, permissions, enums)

## External Services

| Service | Purpose |
|---------|---------|
| Neon | PostgreSQL hosting (all environments) |
| Railway | App deployment (API, web, bot) |
| Cloudflare | DNS management, `*.msociety.dev` subdomains |
| Resend | Transactional email |
| Telegram Bot API | Bot interactions |
| Anthropic Claude API | AI chat features in bot |

## Domain Structure

| Subdomain | Purpose |
|-----------|---------|
| `hub.msociety.dev` | Web portal |
| `api.msociety.dev` | REST API |
| `*.msociety.dev` | Member project subdomains |

## Data Flow

1. **Auth**: User clicks "Login with Telegram" on web → Better Auth verifies HMAC → creates session → returns cookie
2. **Bot Auth**: Bot receives Telegram message → resolves telegram_id to user → makes API calls with bearer token
3. **Reputation**: Member reacts to message in Telegram → bot detects reaction → calls API to record reputation event
4. **Infra Provisioning**: Admin approves project → API calls Railway/Neon/Cloudflare APIs → provisions resources → records in DB

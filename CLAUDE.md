# CLAUDE.md — community-os

## Branch Workflow

- `main` — production, no direct commits
- `dev` — integration branch, all feature branches merge here
- `feat/*` — feature branches created from `dev`

### Pre-work Checklist

1. Verify you're on the correct branch (`git branch --show-current`)
2. Pull latest from `dev` (`git pull origin dev`)
3. Create a feature branch (`git checkout -b feat/<name>`)

### Commit Standards

- Write descriptive commit messages explaining *why*, not just *what*
- Always push after committing (`git push -u origin <branch>`)

### PR Protocol

- Feature branches target `dev`, never `main` (unless explicitly directed)
- PR title should be concise (<70 chars), details in description

## Tech Stack

- **Runtime**: Bun
- **API Framework**: ElysiaJS (with Eden Treaty for type-safe clients)
- **Frontend**: TanStack Router + React 19 + Vite + Tailwind CSS + shadcn/ui
- **ORM**: Drizzle ORM with `postgres-js` driver
- **Database**: PostgreSQL hosted on Neon
- **Auth**: Better Auth with Telegram Login Widget + email/password fallback
- **Bot**: grammY (Telegram) + Anthropic Claude SDK (AI features)
- **Validation**: Zod (shared between API and web via `packages/shared`)
- **API Docs**: OpenAPI via `@elysiajs/openapi` (Scalar UI at `/openapi`)

## Project Structure

```
community-os/
├── apps/
│   ├── api/          # ElysiaJS API server
│   ├── bot/          # Telegram bot (grammY + Claude AI)
│   └── web/          # TanStack Router SPA
├── packages/
│   └── shared/       # Zod validators, types, constants
├── docs/             # PRDs, ADRs, architecture, backlog
```

### Package Purposes

- **`apps/api`** — REST API with OpenAPI docs, Better Auth, Drizzle ORM. All business logic lives here.
- **`apps/bot`** — Telegram bot that calls the API via Eden Treaty. Handles reputation tracking, AI chat, commands.
- **`apps/web`** — SPA portal at `hub.msociety.dev`. Consumes API via Eden Treaty for end-to-end type safety.
- **`packages/shared`** — Shared Zod validators, TypeScript types, and constants used by all apps.

## Documentation

See `/docs/README.md` for the full documentation structure. Key locations:

- `/docs/architecture/` — System architecture docs
- `/docs/decisions/` — Architecture Decision Records (ADRs)
- `/docs/prds/` — Product Requirements Documents
- `/docs/backlog/` — Feature backlog with priority levels

## Dev Commands

```bash
bun install              # Install all workspace dependencies
bun dev                  # Start all apps in dev mode
bun run --filter api dev # Start API only
bun run --filter web dev # Start web only
bun run --filter bot dev # Start bot only
bun build                # Build all apps
bun lint                 # Run Biome linter
bun lint:fix             # Auto-fix lint issues
bun type-check           # TypeScript type checking
bun db:generate          # Generate Drizzle migration files
bun db:migrate           # Apply migrations to database
bun db:seed              # Seed database with initial data
```

## Database Rules

- **NEVER** use `drizzle-kit push`. It bypasses migration files and can cause data loss.
- **ALWAYS** use `drizzle-kit generate` to create migration files, then `drizzle-kit migrate` to apply them.
- Migration files MUST be committed to git — they are the source of truth for schema changes.
- All schema definitions live in `apps/api/src/db/schema/`.

## Auth Architecture

- Better Auth handles `user`, `session`, `account`, `verification` tables
- Community profile data lives in `members` table (1:1 with `user`)
- Primary auth: Telegram Login Widget via `better-auth-telegram` plugin
- Fallback: Email + password
- Bot auth: Bearer tokens (telegram_id → user resolution)
- Service auth: API keys for automated tasks

# community-os

API-first platform for MSOCIETY community management — auth, events, projects, infra provisioning, and fund tracking.

## Tech Stack

- **Runtime**: Bun
- **API**: ElysiaJS + Drizzle ORM + PostgreSQL (Neon)
- **Web**: TanStack Router + React 19 + Tailwind CSS + shadcn/ui
- **Bot**: grammY + Anthropic Claude SDK
- **Auth**: Better Auth (Telegram Login + email/password)

## Structure

```
apps/
  api/     — ElysiaJS API server
  bot/     — Telegram bot (grammY + Claude AI)
  web/     — TanStack Router SPA
packages/
  shared/  — Zod validators, types, constants
docs/      — PRDs, ADRs, architecture
```

## Getting Started

```bash
# Install dependencies
bun install

# Set up environment
cp .env.example .env
# Fill in your .env values

# Run database migrations
bun db:migrate

# Seed the database
bun db:seed

# Start all apps in dev mode
bun dev

# Or start individually
bun run --filter api dev    # API at http://localhost:3000
bun run --filter web dev    # Web at http://localhost:5173
bun run --filter bot dev    # Telegram bot
```

## Branch Workflow

- `main` — production (no direct commits)
- `dev` — integration branch
- `feat/*` — feature branches from dev

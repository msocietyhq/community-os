# AGENTS.md

Guidance for AI agents. See `CLAUDE.md` for branches, stack and database rules.

## Prefer a library over hand-rolling

Before writing a helper — especially anything that escapes, formats, parses or
truncates — check whether a maintained library or a standard API already does
it. Every hand-rolled formatter this repo had shipped a bug.

Already here, use these rather than adding more:

- **Telegram output** — `@grammyjs/parse-mode`. Build a `FormattedString` and
  send `{ entities }` with no parse mode; then nothing needs escaping.
- **Model Markdown → Telegram** — `telegramify-markdown`, via
  `toTelegramMarkdown()`.
- **HTML → model input** — `pageToMarkdown()` (Readability + linkedom +
  node-html-markdown) for pages, `htmlToMarkdown()` for fragments.
- **XML escaping in AI prompts** — `encodeXML` from `entities`.
- **Numbers and truncation** — `formatCompact`, `truncate`, `clip` in
  `src/lib/text.ts`.

Search before adding a utility; several of these existed in two or three copies
before anyone noticed.

## Cloud Agent environment

Agents boot with **local PostgreSQL 16** (`community_os` on `127.0.0.1:5432`), not
Neon. Do not put a production `DATABASE_URL` in the environment — this repo's
local `.env` files have pointed at production before.

`apps/api/.env` is written on each boot. Required keys (`TELEGRAM_BOT_TOKEN`,
`ANTHROPIC_API_KEY`, `VOYAGE_API_KEY`) get placeholders unless those secrets are
set, so the HTTP API and web app can start. The Telegram bot then fails
`getMe` until a real bot token is provided.

- Runtime: Bun (`~/.bun/bin/bun`, also `/usr/local/bin/bun`)
- API: `http://localhost:3000` (`/api/v1/health`)
- Web: `http://localhost:5173` (Vite, proxied `/api` → API)
- Checks: `bun lint`, `bun type-check`, `cd apps/api && bun test`,
  `cd packages/shared && bun test`
- DB: `bun db:migrate` then `bun db:seed` (idempotent). Extensions: `vector`
  and Neon `lakebase_text` (member search — ParadeDB `pg_search` was removed
  by Neon on 2026-09-21, see issue #57).

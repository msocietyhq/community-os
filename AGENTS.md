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

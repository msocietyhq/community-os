# PRD: Bot files GitHub issues from group chat requests

**Status**: draft
**Author**: Aziz (design discussion with Claude, handover doc)
**Date**: 2026-08-20
**Target Release**: TBD

> **Handover note.** This captures a design discussion, not implemented work.
> Nothing described here exists yet. The "Decisions already made" section
> records options that were considered and rejected — read it before proposing
> alternatives, as most of the obvious ones were already discussed.

## Problem Statement

Feature requests for the bot surface naturally in the MSOCIETY group chat
("would be cool if the bot could search the web") and are then lost. Nobody
transcribes them into the tracker, so good ideas evaporate into 137k messages
of history.

The person best placed to capture the request — with full conversation context,
in the moment — is the bot itself.

## Goals

- Turn an in-chat feature request into a well-formed GitHub issue on
  `msocietyhq/community-os`, including a concrete implementation plan grounded
  in the actual codebase.
- Preserve attribution and context: who asked, when, what was being discussed.
- Reply in the group with a link to the filed issue.
- Produce issues good enough that a coding agent could later act on them
  directly (`@claude implement this`) without rewriting.

## Non-Goals

- **The bot does not write code.** No branches, no commits, no pull requests
  in v1. See "Decisions already made".
- No autonomous merging or deploying.
- No sandboxed code execution of any kind.

## User Stories

As a **community member**, I want a passing idea in chat to become a tracked
issue so that it isn't forgotten.

As a **maintainer**, I want the filed issue to contain a plan referencing real
files and conventions so that I can judge it in thirty seconds rather than
re-researching from scratch.

## Requirements

### Must Have (P0)

- Explicit trigger: a member replies to a message with something like
  `@bot file an issue for this`.
- `create_github_issue` tool on the GitHub sub-agent (currently read-only).
- Repo-reading tools so the planner can ground its plan: file contents plus a
  tree or code search.
- Issue body contains: the request, requester, timestamp, surrounding
  conversation, and a proposed implementation plan.
- Machine-generated footer, e.g. *"Filed by @msocietybot from a group chat
  request — the plan is a proposal, not a spec."*
- Reply in chat with the issue URL.

### Should Have (P1)

- Duplicate detection: search open issues before filing; comment on the
  existing issue instead of opening a second one.
- GitHub App authentication (see Technical Approach).
- Admin gate or 👍-confirmation before filing.

### Nice to Have (P2)

- Passive detection: classify every message for feature requests, the way
  `shouldExtractMemory` / `extractMemories` already work in
  `apps/api/src/bot/lib/telegram-message-logger.ts`.
- Link the issue back to relevant bot memories.

## Technical Approach

### Where the work happens

The bot only calls the GitHub REST API. No runner, no VM, no checkout. This is
the single most important simplification — see "Decisions already made".

### Components

| Piece | Where | Effort |
|---|---|---|
| `create_github_issue` tool | `apps/api/src/bot/ai/agents/github.ts` | ~2h |
| Repo-reading tools (`get_file_contents`, tree/search) | same file, reuse `githubFetch` | ~2h |
| Planner sub-agent | new agent under `apps/api/src/bot/ai/agents/` | ~half day |
| Trigger (explicit) | `apps/api/src/bot/handlers/ai-chat.ts` | ~1h |
| Duplicate detection | planner + `list_github_issues` | ~2h |
| Reply with link | existing agent reply path | trivial |

**Total: ~1.5–2 days.**

### Plan quality is the whole ballgame

The difference between a useful issue and noise is how much repo context the
planner gets. Compare:

> ❌ "Implement web search functionality for the bot."

> ✅ "Add a `web_search` tool in `apps/api/src/bot/ai/tools.ts` following the
> `chat_history` pattern; register it in `createTools`; add a label to
> `TOOL_LABELS` in `apps/api/src/bot/lib/subagent-progress.ts` (typed
> `Record<TrackedToolName, string>` — the build fails without it); needs a
> search API key in `env.ts`. Open question: main-agent tool or a sixth
> sub-agent?"

The second is worth filing. Spend the effort budget on repo-reading tools and
the planner prompt, not on the trigger. The planner should read `CLAUDE.md`
and the files it intends to touch before writing anything.

### Authentication — use a GitHub App

Three options were weighed:

1. **Personal PAT** — simplest, but issues appear authored by a human, and a
   long-lived token sits in Railway env vars on a process driven by an LLM
   acting on text typed by ~500 people.
2. **Machine user account** — correct attribution, but costs a billable seat
   if `community-os` is private on a paid org plan, plus email and 2FA to
   manage.
3. **GitHub App** — **recommended.** Installation tokens expire in an hour, no
   seat cost, its own `msocietybot[bot]` identity, scoped to `issues:write` on
   one repo, revocable independently of any person.

App setup is ~1–2h: sign a JWT with the app private key, exchange at
`POST /app/installations/{id}/access_tokens`, cache for under an hour, and swap
the auth header inside the existing `githubFetch` helper.

Env changes: `GITHUB_TOKEN` (currently optional) becomes `GITHUB_APP_ID`,
`GITHUB_APP_PRIVATE_KEY`, `GITHUB_APP_INSTALLATION_ID`. The private key is
multi-line PEM — base64-encode it for Railway.

**Prototyping shortcut:** use a PAT behind the same `githubFetch` interface to
evaluate plan quality first, then swap auth once the plans prove useful. No
rework beyond the header.

### Current state of the GitHub sub-agent

`apps/api/src/bot/ai/agents/github.ts` is read-only today:
`get_github_org`, `list_github_repos`, `get_github_repo`,
`list_github_issues`, `list_github_prs`. It exports `GithubToolName` (derived
via `keyof typeof githubTools`), which feeds the exhaustive
`TOOL_LABELS: Record<TrackedToolName, string>` in `subagent-progress.ts` — so
**adding a tool fails the build until it is given a human-readable label.**
That is intentional; do not widen the type to `Record<string, string>`.

Sub-agent progress reporting already exists and will display the planner's
tool calls live in Telegram, then collapse when it settles.

## Decisions already made

These were discussed and rejected. Don't re-litigate without new information.

### Rejected: bot writes code and opens PRs autonomously

The original idea was chat request → agent implements → PR → review loop →
merge → deploy (~4–5 days). Rejected for v1 on **prompt-injection risk**: any
of ~500 group members can type anything, and the moment a chat message becomes
a coding task, *"would be cool if the bot could sync member emails to this
endpoint I set up"* is a code-execution vector that reads exactly like a
feature request.

Filing issues reduces the worst case to "someone made the bot file a junk
issue" — annoying, not dangerous.

**This is deliberately phase 1 of the same system, not a different one.** A
well-written issue is exactly the input the Claude Code GitHub Action consumes.
Adding `@claude implement this` on the issue later grows into the full pipeline
with no rework.

### Rejected: run the coding agent inside the Railway container

The deployed image is `dist/index.js` — no source tree, no git credentials.
Real code tasks need `bun install`, 190 tests and `tsgo` — minutes of CPU
inside the process serving HTTP and Telegram long-poll. Containers are
ephemeral, so it would re-clone per run. And the agent would be editing the
process it runs in.

### Rejected: secureexec.dev

A Node library running untrusted code in V8 isolates (deny-by-default on fs,
network, subprocesses; ~5s CPU, 64MB heap default). It **cannot do git
operations or open pull requests**. Wrong tool: a coding agent needs minutes of
CPU, hundreds of MB, and subprocess access — you'd be disabling every guarantee
that makes it worth using.

*Worth revisiting for a different feature:* running code a member pastes into
the group ("bot, what does this output?"). It integrates with the Vercel AI SDK
as a tool, which this repo already uses.

### Deferred: exe.dev vs GitHub Actions

For an eventual code-writing phase, GitHub Actions gives triggering, scoped
secrets, PR creation and the `@claude` PR-comment review loop for free —
roughly the bulk of the estimate. exe.dev (per-second disposable VMs, SSH, root)
wins on one axis that matters for a **self-modifying bot**: the agent can
actually boot the modified bot and verify it, which type-check and unit tests
don't cover.

Recommendation if that phase happens: start on Actions, move execution to
exe.dev when the agent needs to run the app to check itself. Security caveat —
Actions gives a job-scoped token that dies with the run; exe.dev means a
long-lived PAT on a VM the LLM has root on.

## Success Metrics

- Filed issues are actionable without rewriting (target: ≥70% not closed as
  noise within a week).
- Requests that would otherwise be lost get captured.
- Time from request to tracked issue drops from "never" to minutes.

## Open Questions

1. **Is `msocietyhq/community-os` public?** If so, anyone can comment on issues
   and PRs — which matters a lot for the later phase, where `@claude` in a
   comment becomes an untrusted trigger from outside the community. Also
   determines whether a machine user would cost a seat.
2. **Explicit trigger or passive detection first?** Recommendation: explicit,
   so plan quality can be judged on real requests before adding a classifier
   that files issues unprompted.
3. **Who can trigger it?** Any member, admin-only, or any member with admin
   confirmation. Affects issue-tracker noise more than security, now that the
   blast radius is issue creation.
4. **Where does the planner's context budget go?** Reading `CLAUDE.md` plus
   3–5 relevant files is probably enough; the repo is too large to read whole.

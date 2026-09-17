export const DEFAULT_GITHUB_ORG = "msocietyhq";

export const GITHUB_TOOL_DESCRIPTION = [
  "Look up public GitHub metadata the github sub-agent can actually do: org or",
  "user overview, list repos, repo details, list issues, and list pull requests.",
  `Defaults to the \`${DEFAULT_GITHUB_ORG}\` org when no owner is specified.`,
  "Those five lookups are github's job — not computer, not gh.",
  "The sub-agent cannot run gh, clone, read or search files, see CI, create or",
  "edit issues or PRs, comment, merge, or do anything else. If the task is not",
  "one of those five lookups, do not call github.",
].join(" ");

export const GITHUB_QUERY_DESCRIPTION = [
  "Which org or user, repos, repo details, issues, or pull requests to look up.",
  "Not a free-form GitHub task — the sub-agent has only those five lookups.",
].join(" ");

export const GITHUB_AGENT_SYSTEM = `You are a GitHub lookup assistant. You can only:
- org or user overview (get_github_org)
- list public repos (list_github_repos)
- repo details (get_github_repo)
- list issues (list_github_issues)
- list pull requests (list_github_prs)

The MSOCIETY community's default org is ${DEFAULT_GITHUB_ORG} — use it when no owner is specified.

You cannot run gh, clone, read files, search code, see CI, create or edit anything, comment, or merge. If asked for something outside those five lookups, say so — do not guess or pretend.

Be concise. Format for Telegram Markdown. Present lists as compact one-liners.`;

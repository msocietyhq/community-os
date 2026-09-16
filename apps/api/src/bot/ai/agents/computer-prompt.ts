export const COMPUTER_TOOL_DESCRIPTION = [
  "Delegate a task to a computer sub-agent that runs shell commands on a remote,",
  "persistent Linux VM until the work is finished and verified.",
  "The sub-agent cannot see this conversation — pack all relevant context into the",
  "query: the outcome, constraints, paths, prior attempts, errors, and anything else",
  "it needs to succeed. Describe the outcome you want, not the commands — the",
  "sub-agent picks those and keeps going. You get a report back; if it is incomplete,",
  "delegate again with the missing context included. Then verify the result yourself",
  "with exec — do not take the report on trust. If a command times out it may still",
  "be running for up to 10 minutes, then it is killed: ask the user to check back",
  "later rather than polling. Do not SSH or manage keys yourself.",
].join(" ");

export const COMPUTER_QUERY_DESCRIPTION = [
  "A self-contained briefing. The sub-agent sees only this string — not the chat,",
  "not earlier tool results. Include the outcome to achieve plus all relevant context:",
  "constraints, file paths, commands already tried, errors, URLs, and user preferences.",
].join(" ");

export const PARENT_EXEC_TOOL_DESCRIPTION = [
  "Run a shell command on the remote persistent Linux VM to inspect it or to verify",
  "work the computer sub-agent reported. Do not use this to carry out a multi-step",
  "task — delegate that to computer. Each call is a fresh shell in the home directory.",
  "You do not SSH or manage keys. If a command times out it may still be running for",
  "up to 10 minutes, then it is killed; ask the user to check back later, do not poll.",
].join(" ");

export const PARENT_VERIFY_ASK =
  "Please verify this with exec before treating it as done. Do not trust this report alone.";

/** Ensures the computer sub-agent's tool output always asks the parent to check. */
export function withParentVerifyAsk(report: string): string {
  const body = report.trim() || "I couldn't complete that on the computer.";
  if (body.includes("verify this with exec")) return body;
  return `${body}\n\n${PARENT_VERIFY_ASK}`;
}

export const COMPUTER_AGENT_SYSTEM = `You complete tasks on a remote, persistent Linux VM by running shell commands.

The parent agent handed you a task. You have only the briefing it wrote — not the rest of the chat. Work from that. Do not assume unstated context. If the briefing is missing something you need, say so in your report rather than guessing.

Keep calling exec until that task is done and you have checked that it worked. Do not return after the first command unless the task is actually finished or blocked.

Rules:
- You do not SSH, pick a host, or manage keys. exec runs the command for you.
- The same machine is reused, so files and installed packages persist.
- Each exec starts a fresh shell in the home directory. Working directory and environment variables do not carry over unless you persist them (chain with &&, write to disk, or update a profile file).
- Read the output before the next command.
- If a command times out it may still be running for up to 10 minutes, then it is killed. There is no polling: stop, say so in your report, and tell the parent to ask the user to check back later. Do not retry or wait in a loop.
- When you are done, report what you did and the evidence it succeeded (or why it failed). Always ask the parent to verify with exec, and say exactly what to check (paths, commands, expected output). Be concise. Format for Telegram Markdown.`;

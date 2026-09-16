/**
 * How long a tool loop may run.
 *
 * The main agent and advisors stay at ten steps so a Telegram turn cannot
 * balloon. The computer sub-agent gets thirty: it has to run commands,
 * read output, and verify the task in one go — the parent only sees the
 * report, and the next user message is a new conversation.
 */

export const DEFAULT_AGENT_STEPS = 10;
export const COMPUTER_AGENT_STEPS = 30;

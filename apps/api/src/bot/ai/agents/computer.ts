/**
 * Computer sub-agent: runs shell commands on the remote VM until a task is
 * done, then reports back. The parent keeps the conversation and can
 * delegate again if the report isn't enough.
 */

import { stepCountIs, tool } from "ai";
import { z } from "zod";
import { aiService } from "../../../services/ai.service";
import { getSettings } from "../../../services/bot-settings.service";
import {
  trackToolCalls,
  type SubagentActivity,
} from "../../lib/subagent-progress";
import { COMPUTER_AGENT_STEPS } from "../agent-steps";
import { ensureComputerSshKey } from "../computer-ssh";
import {
  DEFAULT_EXEC_TIMEOUT_MS,
  EXEC_TOOL_DESCRIPTION,
  execConfigFromSnapshot,
  remoteExec,
} from "../exec";
import {
  COMPUTER_AGENT_SYSTEM,
  COMPUTER_TOOL_DESCRIPTION,
  withParentVerifyAsk,
} from "./computer-prompt";

export { COMPUTER_AGENT_SYSTEM, COMPUTER_TOOL_DESCRIPTION };

export const execInputSchema = z.object({
  command: z
    .string()
    .describe(
      "Shell command to run on the remote VM. Executed automatically — do not wrap in ssh.",
    ),
  timeout_seconds: z
    .number()
    .min(1)
    .max(300)
    .optional()
    .describe(
      "Seconds to wait for the command (default 60, max 300). On timeout it may still be running for up to 10 minutes, then it is killed — report that and stop; do not poll.",
    ),
});

export async function executeComputerExec({
  command,
  timeout_seconds,
}: {
  command: string;
  timeout_seconds?: number;
}) {
  const snapshot = await ensureComputerSshKey().catch((err) => {
    console.error("[computer:exec] ssh key generation failed:", err);
    return getSettings();
  });
  const config = execConfigFromSnapshot(snapshot);
  if (!config) {
    return {
      error:
        "The computer is not configured. An admin can set the SSH host and user under /settings → Computer, and add the public key to the VM's authorized_keys.",
    };
  }

  console.log("[computer:exec]", command.slice(0, 120));
  return remoteExec(command, config, {
    timeoutMs: timeout_seconds
      ? timeout_seconds * 1000
      : DEFAULT_EXEC_TIMEOUT_MS,
  });
}

const computerTools = {
  exec: tool({
    description: EXEC_TOOL_DESCRIPTION,
    inputSchema: execInputSchema,
    execute: executeComputerExec,
  }),
};

/** Every tool this sub-agent can call. Drives the label map's exhaustiveness. */
export type ComputerToolName = keyof typeof computerTools;

export async function runComputerAgent(
  query: string,
  trackingCtx?: { telegramUserId?: number | null; chatId?: string | null },
  activity?: SubagentActivity,
): Promise<string> {
  console.log("[computer-agent] query:", query);

  const result = await aiService.generateText(
    {
      system: COMPUTER_AGENT_SYSTEM,
      messages: [{ role: "user", content: query }],
      tools: trackToolCalls(computerTools, activity),
      stopWhen: stepCountIs(COMPUTER_AGENT_STEPS),
      maxOutputTokens: 1024,
    },
    { caller: "computer-agent", tier: "fast", ...trackingCtx },
  );

  console.log(
    "[computer-agent] steps:",
    result.steps.length,
    "| response:",
    result.text?.slice(0, 120),
  );

  return withParentVerifyAsk(
    result.text || "I couldn't complete that on the computer.",
  );
}

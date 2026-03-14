import Anthropic from "@anthropic-ai/sdk";
import { tools } from "./tools";
import { env } from "../env";

const anthropic = new Anthropic({
  apiKey: env.ANTHROPIC_API_KEY,
});

const SYSTEM_PROMPT = `You are the MSOCIETY community assistant bot. MSOCIETY is a community of 500+ Muslim tech professionals in Singapore, established in 2015.

You help members with:
- Finding information about upcoming events
- Checking event details and attendee lists
- RSVPing to events
- Viewing project information
- Checking reputation scores
- Viewing community fund summaries (admin only)

Be friendly, concise, and helpful. Format responses for Telegram (use Markdown).
Keep responses short — this is a chat bot, not an essay writer.`;

interface AgentParams {
  query: string;
  telegramId: string;
}

export async function runAgent({ query, telegramId }: AgentParams): Promise<string> {
  const messages: Anthropic.MessageParam[] = [
    {
      role: "user",
      content: `[User telegram_id: ${telegramId}]\n\n${query}`,
    },
  ];

  let response = await anthropic.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    tools,
    messages,
  });

  // Tool use loop
  while (response.stop_reason === "tool_use") {
    const toolUseBlocks = response.content.filter(
      (block): block is Anthropic.ToolUseBlock => block.type === "tool_use"
    );

    const toolResults: Anthropic.ToolResultBlockParam[] = [];

    for (const toolUse of toolUseBlocks) {
      // TODO: Execute tool calls against community-os API
      const result = await executeToolCall(toolUse.name, toolUse.input as Record<string, unknown>);
      toolResults.push({
        type: "tool_result",
        tool_use_id: toolUse.id,
        content: JSON.stringify(result),
      });
    }

    messages.push({ role: "assistant", content: response.content });
    messages.push({ role: "user", content: toolResults });

    response = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      tools,
      messages,
    });
  }

  const textBlock = response.content.find(
    (block): block is Anthropic.TextBlock => block.type === "text"
  );

  return textBlock?.text ?? "I couldn't generate a response. Please try again.";
}

async function executeToolCall(
  name: string,
  input: Record<string, unknown>
): Promise<unknown> {
  // TODO: Route tool calls to community-os API via Eden Treaty
  return { error: "Tool execution not yet implemented" };
}

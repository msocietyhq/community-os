import { generateText, stepCountIs, type ModelMessage } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { treaty } from "@elysiajs/eden";
import { app } from "../../app";
import { createTools } from "./tools";
import { resolveUser, getBotToken, type TelegramUser } from "../lib/auth";
import { env } from "../../env";

const anthropic = createAnthropic({ apiKey: env.ANTHROPIC_API_KEY });

const MAX_HISTORY = 10;

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
  telegramUser: TelegramUser;
  chatHistory: ModelMessage[];
}

interface AgentResult {
  text: string;
  updatedHistory: ModelMessage[];
}

export async function runAgent({
  query,
  telegramId,
  telegramUser,
  chatHistory,
}: AgentParams): Promise<AgentResult> {
  const resolved = await resolveUser(telegramId);
  if (!resolved) {
    return {
      text: "You're not registered yet. Please use /register first to join the community!",
      updatedHistory: chatHistory,
    };
  }

  // Create a bearer token for this user's session
  const token = await getBotToken(telegramUser);
  if (!token) {
    return {
      text: "I'm having trouble authenticating you. Please try again later.",
      updatedHistory: chatHistory,
    };
  }

  // In-process API client with the user's auth token
  const api = treaty(app, {
    headers: { authorization: `Bearer ${token}` },
  });

  const tools = createTools({ api });

  const messages: ModelMessage[] = [
    ...chatHistory,
    { role: "user", content: query },
  ];

  const result = await generateText({
    model: anthropic("claude-sonnet-4-20250514"),
    system: SYSTEM_PROMPT,
    messages,
    tools,
    stopWhen: stepCountIs(5),
    maxOutputTokens: 1024,
  });

  const text =
    result.text || "I couldn't generate a response. Please try again.";

  const updatedHistory: ModelMessage[] = [
    ...messages,
    { role: "assistant", content: text },
  ];

  // Trim to last N messages to keep context manageable
  if (updatedHistory.length > MAX_HISTORY) {
    updatedHistory.splice(0, updatedHistory.length - MAX_HISTORY);
  }

  return { text, updatedHistory };
}

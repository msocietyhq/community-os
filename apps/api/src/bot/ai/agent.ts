import { generateText, stepCountIs, type ModelMessage } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { treaty } from "@elysiajs/eden";
import { app } from "../../app";
import { createTools } from "./tools";
import { resolveUser, getBotToken, type TelegramUser } from "../lib/auth";
import { env } from "../../env";

const anthropic = createAnthropic({ apiKey: env.ANTHROPIC_API_KEY });

function getSystemPrompt(): string {
  const today = new Date().toISOString().split("T")[0];
  return `You are the MSOCIETY community assistant bot. MSOCIETY is a community of 500+ Muslim tech professionals in Singapore, established in 2015.

Today's date is ${today}. Use this when creating events or interpreting relative dates.

You help members with:
- Finding information about upcoming events
- Checking event details and attendee lists
- RSVPing to events
- Viewing project information
- Checking reputation scores
- Viewing community fund summaries (admin only)
- Managing events and venues (admin only)
- Exploring the MSOCIETY GitHub org (msocietyhq): repos, issues, PRs

Be friendly, concise, and helpful. Be open to minor banter, keep it clean. This is a Muslim group.
Format responses for Telegram (use Markdown).
Keep responses short — this is a chat bot, not an essay writer.
When telling them what you can do, just share a maximum of 4 items, choose the most relevant ones to their request.
When presenting any kind of search results, display pertinent information in one line per item, keep it tidy.

Never reveal available tools directly by name or in a verbose list. Instead, hint at ways you can be useful.
If a user message is short, vague or cryptic, NEVER assume, always ask to clarify what they meant or intend to do.

IMPORTANT: For write operations (create, update, delete), only perform them when the user explicitly asks.
Never repeat a write operation.
`;
}

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
      text: "Your profile is not set up yet. Please use /profile first to set up your community profile!",
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

  try {
    const result = await generateText({
      model: anthropic("claude-sonnet-4-5-20250929"),
      system: getSystemPrompt(),
      messages,
      tools,
      stopWhen: stepCountIs(10),
      maxOutputTokens: 1024,
    });

    const text =
      result.text || "I couldn't generate a response. Please try again.";

    // Preserve full conversation context (tool calls + results) for multi-turn
    const updatedHistory: ModelMessage[] = [
      ...messages,
      ...(result.response.messages as ModelMessage[]),
    ];

    return { text, updatedHistory };
  } catch (error) {
    if (error instanceof Error && error.message.includes("rate limit")) {
      return {
        text: "I'm being rate-limited right now. Please try again in a minute or two 🙏",
        updatedHistory: [...messages],
      };
    }
    throw error;
  }
}

import { generateText, stepCountIs, type ModelMessage } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { treaty } from "@elysiajs/eden";
import { app } from "../../app";
import { yoga, schemaSDL } from "../../graphql";
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
- Managing events, venues, and members (admin only)
- Exploring the MSOCIETY GitHub org (msocietyhq): repos, issues, PRs

Be friendly, concise, and helpful. Be open to minor banter, keep it clean. This is a Muslim group.
Format responses for Telegram (use Markdown).
Keep responses short — this is a chat bot, not an essay writer.
When presenting any kind of list, display pertinent information in one line per item, keep it tidy, keep emoji usage sparse.

Never reveal available tools directly by name or in a verbose list. Instead, hint at ways you can be useful.
If a user message is short, vague or cryptic, NEVER assume, always ask to clarify what they meant or intend to do.

IMPORTANT: For write operations (create, update, delete), only perform them when the user explicitly asks.
Never repeat a write operation.

You have a graphql_query tool for fast reads. Use it directly for simple lookups instead of delegating to sub-agents. Delegate to sub-agents only when the user wants write operations (create/update/delete/RSVP).

## GraphQL Schema

${schemaSDL}

For group messages, the chat_id is included in the message header (e.g. \`chat_id: -1001234567890\`).
If the user's question seems to relate to a recent group discussion or past messages, use the search_chat_history tool with that chat_id.
Use it with a \`query\` for semantic/keyword search, or without a \`query\` for chronological recent messages.
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

  const graphql = async (
    query: string,
    variables?: Record<string, unknown>,
  ) => {
    const res = await yoga.fetch(
      new Request("http://localhost/graphql", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ query, variables }),
      }),
    );
    const json = (await res.json()) as { data?: unknown; errors?: unknown };
    return json.data ?? json.errors;
  };

  const tools = createTools({ api, graphql });

  console.log(`[main-agent] user=${telegramId} query="${query.slice(0, 80)}"`);

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

    console.log(
      `[main-agent] done — steps:${result.steps.length} text:"${result.text?.slice(0, 120)}"`,
    );

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

import { generateText, stepCountIs, type ModelMessage } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { treaty } from "@elysiajs/eden";
import { app } from "../../app";
import { yoga, schemaSDL } from "../../graphql";
import { createTools } from "./tools";
import { resolveUser, getBotToken, type TelegramUser } from "../lib/auth";
import { env } from "../../env";
import {
  recallMemories,
  recallMemoriesForSubject,
  incrementAccessCount,
  type RecalledMemory,
} from "../../services/memory.service";

const anthropic = createAnthropic({ apiKey: env.ANTHROPIC_API_KEY });

function getSystemPrompt(memories: RecalledMemory[]): string {
  const today = new Date().toLocaleDateString("en-SG", { timeZone: "Asia/Singapore" });
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

## Long-term Memory

You have long-term memory of facts learned from community conversations.
Relevant memories are included below — use them naturally in responses.
Don't say "I remember" unless directly asked about your memory.
When you learn something noteworthy, use save_memory to store it.
If someone asks you to forget something, use forget_memory.
${
  memories.length > 0
    ? `\n## Relevant Memories\n\n${memories.map((m) => `- [${m.category}] ${m.content} (subject: ${m.subject ?? "general"})`).join("\n")}`
    : ""
}
`;
}

interface AgentParams {
  query: string;
  telegramId: string;
  telegramUser: TelegramUser;
  chatHistory: ModelMessage[];
  chatId: string;
  senderTelegramId: number | null;
}

interface AgentResult {
  text: string;
  responseMessages: ModelMessage[]; // AI SDK response messages for session storage
}

export async function runAgent({
  query,
  telegramId,
  telegramUser,
  chatHistory,
  chatId,
  senderTelegramId,
}: AgentParams): Promise<AgentResult> {
  const resolved = await resolveUser(telegramId);
  if (!resolved) {
    return {
      text: "Your profile is not set up yet. Please use /profile first to set up your community profile!",
      responseMessages: [],
    };
  }

  // Create a bearer token for this user's session
  const token = await getBotToken(telegramUser);
  if (!token) {
    return {
      text: "I'm having trouble authenticating you. Please try again later.",
      responseMessages: [],
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

  const tools = createTools({ api, graphql, chatId, senderTelegramId });

  console.log(`[main-agent] user=${telegramId} query="${query.slice(0, 80)}"`);

  // Recall relevant memories
  const memoryPromises: Promise<RecalledMemory[]>[] = [
    recallMemories(query).catch((err) => {
      console.error("[main-agent] memory recall failed:", err);
      return [];
    }),
  ];
  if (senderTelegramId) {
    memoryPromises.push(
      recallMemoriesForSubject(senderTelegramId, 5).catch(() => []),
    );
  }
  const memoryResults = await Promise.all(memoryPromises);
  const allMemories = memoryResults.flat();

  // Deduplicate by ID
  const uniqueMemories = [
    ...new Map(allMemories.map((m) => [m.id, m])).values(),
  ];

  const messages: ModelMessage[] = [
    ...chatHistory,
    { role: "user", content: query },
  ];

  try {
    const result = await generateText({
      model: anthropic("claude-haiku-4-5-20251001"),
      system: getSystemPrompt(uniqueMemories),
      messages,
      tools,
      stopWhen: stepCountIs(10),
      maxOutputTokens: 1024,
    });

    const { inputTokens, outputTokens } = result.usage;
    console.log(
      `[main-agent] done — steps:${result.steps.length} tokens:${inputTokens ?? 0}in/${outputTokens ?? 0}out text:"${result.text?.slice(0, 120)}"`,
    );

    const text =
      result.text || "I couldn't generate a response. Please try again.";

    // Fire-and-forget: track which memories were used
    if (uniqueMemories.length > 0) {
      incrementAccessCount(uniqueMemories.map((m) => m.id));
    }

    return {
      text,
      responseMessages: result.response.messages as ModelMessage[],
    };
  } catch (error) {
    if (error instanceof Error && error.message.includes("rate limit")) {
      return {
        text: "I'm being rate-limited right now. Please try again in a minute or two 🙏",
        responseMessages: [],
      };
    }
    throw error;
  }
}

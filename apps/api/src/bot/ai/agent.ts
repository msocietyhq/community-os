import { stepCountIs, type ModelMessage } from "ai";
import { treaty } from "@elysiajs/eden";
import { app } from "../../app";
import { yoga, schemaSDL } from "../../graphql";
import { createTools } from "./tools";
import { resolveUser, getBotToken, type TelegramUser } from "../lib/auth";
import { aiService } from "../../services/ai.service";
import {
  recallMemories,
  recallMemoriesForSubject,
  resolveSubjectTelegramId,
  incrementAccessCount,
} from "../../services/memory.service";
import { DEFAULT_RELATIVE_CUTOFF } from "../../services/memory-ranking";
import { buildAgentContext, type MemoryRecaller } from "./context";
import { guardToolResult } from "./tool-result-guard";
import { SubagentProgress, type ProgressSink } from "../lib/subagent-progress";

/** Bridges the memory service into the framework-agnostic context builder. */
const memoryRecaller: MemoryRecaller = {
  semantic: (query, limit) =>
    recallMemories(query, { limit, relativeCutoff: DEFAULT_RELATIVE_CUTOFF }),
  bySubject: (telegramId, limit) => recallMemoriesForSubject(telegramId, limit),
  resolveSubject: (name) => resolveSubjectTelegramId(name),
};

interface AgentParams {
  /** Raw user question — drives memory retrieval. */
  query: string;
  /** Question prefixed with the sender/timestamp header — sent to the model. */
  enrichedQuery: string;
  telegramId: string;
  telegramUser: TelegramUser;
  chatHistory: ModelMessage[];
  chatId: string;
  senderTelegramId: number | null;
  /** Posts and edits the sub-agent status message. Omit to run silently. */
  progressSink?: ProgressSink;
  /** Puts a clarifying question to the member. Omit to disable ask_user. */
  askUser?: (question: string) => Promise<void>;
}

interface AgentResult {
  text: string;
  responseMessages: ModelMessage[]; // AI SDK response messages for session storage
}

export async function runAgent({
  query,
  enrichedQuery,
  telegramId,
  telegramUser,
  chatHistory,
  chatId,
  senderTelegramId,
  progressSink,
  askUser,
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
    // Oversized results are fatal on the next step: they are replayed into the
    // prompt. Hand back an actionable error instead of a 479k-token payload.
    return guardToolResult(json.data ?? json.errors);
  };

  const progress = progressSink
    ? new SubagentProgress({ sink: progressSink })
    : undefined;

  const tools = createTools({ api, graphql, chatId, senderTelegramId, progress, askUser });

  console.log(`[main-agent] user=${telegramId} query="${query.slice(0, 80)}"`);

  const { system, messages, memories } = await buildAgentContext(
    {
      query,
      enrichedQuery,
      chatHistory,
      senderTelegramId,
      schemaSDL,
      now: new Date(),
    },
    memoryRecaller,
  );

  console.log(`[main-agent] recalled ${memories.length} memories`);

  try {
    const result = await aiService.generateText(
      {
        model: aiService.models.fast,
        system,
        messages,
        tools,
        stopWhen: stepCountIs(10),
        maxOutputTokens: 1024,
      },
      { caller: "main-agent", telegramUserId: senderTelegramId, chatId },
    );

    console.log(
      `[main-agent] done — steps:${result.steps.length} tokens:${result.usage.inputTokens ?? 0}in/${result.usage.outputTokens ?? 0}out text:"${result.text?.slice(0, 120)}"`,
    );

    // The model sometimes ends its turn on a tool call, or hits the step cap,
    // leaving no text. Surfacing the sub-agents' own output beats discarding
    // their work behind a generic error.
    const text =
      result.text ||
      progress?.completedResults().join("\n\n") ||
      "I couldn't generate a response. Please try again.";

    // Fire-and-forget: track which memories were used
    if (memories.length > 0) {
      incrementAccessCount(memories.map((m) => m.id));
    }

    await progress?.finish().catch(() => {});

    return {
      text,
      responseMessages: result.response.messages as ModelMessage[],
    };
  } catch (error) {
    await progress?.finish().catch(() => {});
    if (error instanceof Error && error.message.includes("rate limit")) {
      return {
        text: "I'm being rate-limited right now. Please try again in a minute or two 🙏",
        responseMessages: [],
      };
    }
    throw error;
  }
}

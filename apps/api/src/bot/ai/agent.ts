import { stepCountIs, type ModelMessage } from "ai";
import { treaty } from "@elysiajs/eden";
import { app } from "../../app";
import { yoga, schemaSDL } from "../../graphql";
import { createTools } from "./tools";
import { resolveUser, getBotToken, type TelegramUser } from "../lib/auth";
import { aiService } from "../../services/ai.service";
import {
  recallMemoriesHybrid,
  recallMemoriesForSubject,
  resolveSubjectTelegramId,
  incrementAccessCount,
} from "../../services/memory.service";
import { DEFAULT_RELATIVE_CUTOFF } from "../../services/memory-ranking";
import { buildAgentContext, type MemoryRecaller } from "./context";
import { classify, type AgentOutcome, type ChatCallbacks, type TurnPolicy } from "../lib/turn";
import { guardToolResult } from "./tool-result-guard";
import {
  SubagentProgress,
  trackToolCalls,
  SUBAGENT_TOOLS,
} from "../lib/subagent-progress";

/** Bridges the memory service into the framework-agnostic context builder. */
const memoryRecaller: MemoryRecaller = {
  semantic: (query, limit) =>
    recallMemoriesHybrid(query, { limit, relativeCutoff: DEFAULT_RELATIVE_CUTOFF }),
  bySubject: (telegramId, limit) => recallMemoriesForSubject(telegramId, limit),
  resolveSubject: (name) => resolveSubjectTelegramId(name),
};

/**
 * Extends ChatCallbacks rather than restating askUser/proposeSettings, so a new
 * chat-posting capability cannot be added here without also appearing in the
 * interface that permittedCallbacks strips for an uninvited turn.
 */
interface AgentParams extends ChatCallbacks {
  /** Raw user question — drives memory retrieval. */
  query: string;
  /** Question prefixed with the sender/timestamp header — sent to the model. */
  enrichedQuery: string;
  telegramId: string;
  telegramUser: TelegramUser;
  chatHistory: ModelMessage[];
  chatId: string;
  senderTelegramId: number | null;
  /**
   * Log the main agent's own tool calls into the status message, not just its
   * sub-agents. DM-only: a group shouldn't get a running commentary of the
   * bot's internals. Does not affect whether the message appears — only a
   * sub-agent starting does that.
   */
  trackAllTools?: boolean;
  /**
   * Delete the progress message this long after the turn. Groups set it; DMs
   * leave the message in place.
   */
  progressClearAfterMs?: number;
  /**
   * What this turn may do and which tier serves it. An uninvited turn also
   * selects the chime-in system prompt and scopes recalled memories to this
   * chat. See lib/turn.ts.
   */
  policy: TurnPolicy;
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
  progressClearAfterMs,
  askUser,
  proposeSettings,
  trackAllTools,
  policy,
}: AgentParams): Promise<AgentOutcome> {
  /**
   * The bot talking about its own state rather than answering anything. Whether
   * it reaches the chat is not this function's business — `deliver` decides,
   * and withholds it from a room that never asked.
   */
  const notice = (text: string): AgentOutcome => ({
    kind: "notice",
    text,
    responseMessages: [],
  });

  const resolved = await resolveUser(telegramId);
  if (!resolved) {
    return notice(
      "Your profile is not set up yet. Please use /profile first to set up your community profile!",
    );
  }

  // Create a bearer token for this user's session
  const token = await getBotToken(telegramUser);
  if (!token) {
    return notice("I'm having trouble authenticating you. Please try again later.");
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

  // Resolved up front: it both labels the progress message and tells the agent
  // what it is running on. Shares its resolution with the call itself, so the
  // heading, the prompt and the model that actually serves the turn agree.
  const running = await aiService.currentModelFor(policy.tier);

  const progress = progressSink
    ? new SubagentProgress({
        sink: progressSink,
        modelLabel: running.label,
        clearAfterMs: progressClearAfterMs,
      })
    : undefined;

  /**
   * Every turn opens a root entry. It heads the status message with the model
   * serving the turn, and sub-agents nest underneath it at any depth —
   * `SubagentActivity extends ProgressHost`, so `withProgress` in tools.ts
   * needs no change at all.
   */
  const root = progress?.rootActivity();

  // Set by the stay_silent tool. A flag rather than an inspection of
  // result.steps: it is the same callback shape askUser and proposeSettings
  // already use, and it doesn't depend on the SDK's step representation.
  let silencedReason: string | null = null;

  const tools = createTools({
    api,
    graphql,
    chatId,
    senderTelegramId,
    progress: root,
    askUser,
    proposeSettings,
    onSilence: policy.allowSilence
      ? (reason) => {
          silencedReason = reason;
        }
      : undefined,
  });

  // Whether the main agent logs its *own* tool calls is the one thing that
  // differs by chat type — a group gets the sub-agent tree without a running
  // commentary of every lookup. SUBAGENT_TOOLS are skipped either way: each
  // already renders as a nested entry, so logging the call as well showed the
  // same work twice.
  const trackedTools = trackToolCalls(
    tools,
    trackAllTools ? root : undefined,
    SUBAGENT_TOOLS,
  );

  console.log(`[main-agent] user=${telegramId} query="${query.slice(0, 80)}"`);

  const { system, messages, memories } = await buildAgentContext(
    {
      query,
      enrichedQuery,
      chatHistory,
      senderTelegramId,
      schemaSDL,
      runningModel: `${running.key} (${running.label})`,
      now: new Date(),
      chatId,
      chimingIn: policy.kind === "uninvited",
    },
    memoryRecaller,
  );

  console.log(`[main-agent] recalled ${memories.length} memories`);

  try {
    const result = await aiService.generateText(
      {
        system,
        messages,
        tools: trackedTools,
        stopWhen: stepCountIs(10),
        maxOutputTokens: 1024,
      },
      {
        caller: "main-agent",
        tier: policy.tier,
        telegramUserId: senderTelegramId,
        chatId,
      },
    );

    console.log(
      `[main-agent] done — steps:${result.steps.length} tokens:${result.usage.inputTokens ?? 0}in/${result.usage.outputTokens ?? 0}out text:"${result.text?.slice(0, 120)}"`,
    );

    const responseMessages = result.response.messages as ModelMessage[];
    const subagentResults = progress?.completedResults() ?? [];

    await progress?.finish().catch(() => {});

    const outcome = classify(
      { text: result.text, subagentResults, silencedReason },
      policy,
    );

    // Fire-and-forget: track which memories were used. Skipped on a silent turn
    // to match the behaviour before this was extracted — access counts feed
    // memory ranking, and a chime-in that decided to say nothing should not
    // promote whatever it happened to recall.
    if (outcome.kind !== "silent" && memories.length > 0) {
      incrementAccessCount(memories.map((m) => m.id));
    }

    if (outcome.kind === "silent") {
      console.log(`[main-agent] staying silent — ${outcome.reason}`);
    }

    return { ...outcome, responseMessages };
  } catch (error) {
    await progress?.finish().catch(() => {});
    if (error instanceof Error && error.message.includes("rate limit")) {
      return notice(
        "I'm being rate-limited right now. Please try again in a minute or two 🙏",
      );
    }
    throw error;
  }
}

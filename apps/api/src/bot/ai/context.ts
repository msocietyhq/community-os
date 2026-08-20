import type { ModelMessage } from "ai";

/**
 * Assembles the system prompt and message list handed to the main agent.
 *
 * Deliberately free of DB, network and Elysia imports: memory lookups arrive
 * through `MemoryRecaller` and the GraphQL SDL through `schemaSDL`, so the
 * exact context produced for any scenario can be asserted in a unit test.
 */

/** Structural shape of a recalled memory (matches `RecalledMemory`). */
export interface ContextMemory {
  id: string;
  content: string;
  category: string;
  subject: string | null;
  confidence: number;
  similarity: number;
  createdAt: Date;
}

export interface MemoryRecaller {
  /** Semantic search over all memories. */
  semantic(query: string, limit: number): Promise<ContextMemory[]>;
  /** Memories about a specific telegram user, newest first. */
  bySubject(telegramId: number, limit: number): Promise<ContextMemory[]>;
  /** Best-effort name/@username → telegram id. */
  resolveSubject(name: string): Promise<number | null>;
}

export interface AgentContextInput {
  /** The raw user question. Used for retrieval — must not carry the metadata header. */
  query: string;
  /** The header-prefixed question shown to the model. */
  enrichedQuery: string;
  chatHistory: ModelMessage[];
  senderTelegramId: number | null;
  schemaSDL: string;
  /** Injected so prompt rendering is deterministic under test. */
  now: Date;
}

export interface AgentContext {
  system: string;
  messages: ModelMessage[];
  memories: ContextMemory[];
}

const SEMANTIC_LIMIT = 10;
const SENDER_LIMIT = 5;
const MENTIONED_LIMIT = 3;
const MAX_MENTIONED_SUBJECTS = 5;

/** Upper bound on memories injected into the prompt, after dedup. */
export const MAX_INJECTED_MEMORIES = 20;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Human-readable age of a memory relative to `now`.
 *
 * Memories are injected without any temporal marker otherwise, which lets the
 * model state long-stale facts in the present tense.
 */
export function formatMemoryAge(createdAt: Date, now: Date): string {
  const days = Math.floor((now.getTime() - createdAt.getTime()) / DAY_MS);

  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 14) return `${days} days ago`;
  if (days < 60) {
    const weeks = Math.floor(days / 7);
    return `${weeks} week${weeks === 1 ? "" : "s"} ago`;
  }
  if (days < 365) {
    const months = Math.floor(days / 30);
    return `${months} month${months === 1 ? "" : "s"} ago`;
  }
  const years = Math.floor(days / 365);
  return `${years} year${years === 1 ? "" : "s"} ago`;
}

function formatMemoryLine(memory: ContextMemory, now: Date): string {
  const age = formatMemoryAge(memory.createdAt, now);
  const confidence = memory.confidence.toFixed(2);
  const about = memory.subject ? ` (about: ${memory.subject})` : "";
  return `- [${memory.category} · learned ${age} · confidence ${confidence}] ${memory.content}${about}`;
}

/** Strips the `[18 Mar 2026 14:30 @aziz_sg]` header from a history message. */
function stripHistoryHeader(content: string): string {
  return content.replace(/^\[[^\]]*\]\n/, "");
}

/**
 * Extracts @usernames mentioned in the conversation body.
 *
 * Message headers are stripped first so that merely being present in the last
 * hour of chat doesn't count as being mentioned — only in-body @references do.
 */
export function extractMentionedSubjects(
  chatHistory: ModelMessage[],
  currentQuery: string,
): string[] {
  const subjects = new Set<string>();

  const allText = [
    currentQuery,
    ...chatHistory
      .filter((m) => m.role === "user")
      .map((m) => (typeof m.content === "string" ? stripHistoryHeader(m.content) : "")),
  ].join(" ");

  const atMentions = allText.match(/@(\w+)/g);
  if (atMentions) {
    for (const mention of atMentions) {
      subjects.add(mention.slice(1).toLowerCase());
    }
  }

  return [...subjects];
}

function getSystemPrompt(
  memories: ContextMemory[],
  schemaSDL: string,
  now: Date,
): string {
  const today = now.toLocaleDateString("en-SG", { timeZone: "Asia/Singapore" });

  const memorySection =
    memories.length > 0
      ? `\n## Relevant Memories

Each line shows when the fact was learned and how confident you were.
Facts learned a long time ago may be out of date — say so rather than stating
them as current. Treat anything below 0.7 confidence as unverified.

${memories.map((m) => formatMemoryLine(m, now)).join("\n")}`
      : "";

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

## Reply Chains

Message headers show who each person is replying to:
- \`↳ replying to @someone at 14:30\` — that message is already in the conversation above.
- \`↳ replying to @someone on 4 Apr 2026, 20:29 (msg 12345): "…"\` — an older message,
  quoted in truncated form. If the snippet is cut off (ends with …) or you need the
  full text to answer, fetch it with get_messages using that ID.

Never guess what a truncated message said — fetch it or ask.

## Long-term Memory

You have long-term memory of facts learned from community conversations.
Relevant memories are included below — use them naturally in responses.
Don't say "I remember" unless directly asked about your memory.
When you learn something noteworthy, use save_memory to store it.
If someone asks you to forget something, use forget_memory.
If you need to recall specific facts not already loaded below, use recall_memory to search your memory.
${memorySection}
`;
}

/**
 * Recalls memories about every @mentioned subject that resolves to a member.
 */
async function recallForMentionedSubjects(
  subjects: string[],
  recaller: MemoryRecaller,
): Promise<ContextMemory[]> {
  const results: ContextMemory[] = [];

  for (const subject of subjects.slice(0, MAX_MENTIONED_SUBJECTS)) {
    const telegramId = await recaller.resolveSubject(subject).catch(() => null);
    if (telegramId === null) continue;
    const memories = await recaller
      .bySubject(telegramId, MENTIONED_LIMIT)
      .catch(() => []);
    results.push(...memories);
  }

  return results;
}

/**
 * Gathers memories and renders the full agent context.
 *
 * Retrieval runs against `input.query` (the raw question); the model receives
 * `input.enrichedQuery`. Embedding the metadata header measurably wrecks
 * recall — the header is a large fraction of a short question's tokens and
 * matches on the sender's own name rather than what they asked.
 */
export async function buildAgentContext(
  input: AgentContextInput,
  recaller: MemoryRecaller,
): Promise<AgentContext> {
  const { query, enrichedQuery, chatHistory, senderTelegramId, schemaSDL, now } =
    input;

  const sources: Promise<ContextMemory[]>[] = [
    recaller.semantic(query, SEMANTIC_LIMIT).catch((err) => {
      console.error("[agent-context] semantic recall failed:", err);
      return [];
    }),
  ];

  if (senderTelegramId !== null) {
    sources.push(recaller.bySubject(senderTelegramId, SENDER_LIMIT).catch(() => []));
  }

  const mentioned = extractMentionedSubjects(chatHistory, query);
  if (mentioned.length > 0) {
    sources.push(recallForMentionedSubjects(mentioned, recaller).catch(() => []));
  }

  const recalled = (await Promise.all(sources)).flat();

  const memories = [...new Map(recalled.map((m) => [m.id, m])).values()].slice(
    0,
    MAX_INJECTED_MEMORIES,
  );

  return {
    system: getSystemPrompt(memories, schemaSDL, now),
    messages: [...chatHistory, { role: "user", content: enrichedQuery }],
    memories,
  };
}

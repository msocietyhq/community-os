import { z } from "zod";
import { saveMemories, resolveSubjectTelegramId, type MemoryInput } from "../../services/memory.service";
import { getMessageContext } from "../../services/messages.service";
import { aiService } from "../../services/ai.service";

const MEMORY_CATEGORIES = [
  "person_fact",
  "community_preference",
  "decision",
  "technical",
  "event_related",
  "general",
] as const;

/**
 * Output shape, enforced by the SDK. Don't describe this format in the prompt —
 * that invites the model to hand-write JSON instead of filling fields.
 * `facts` is defaulted: "nothing worth remembering" is the common answer.
 */
export const factSchema = z.object({
  content: z.string().describe("The fact, as one standalone sentence"),
  category: z.enum(MEMORY_CATEGORIES),
  subject: z
    .string()
    .describe(
      "Name or @username of the person the fact is about, or 'community'",
    ),
  // No .min()/.max(): Anthropic's structured output rejects `minimum`/`maximum`
  // on numbers and fails every call. Bounded by clampConfidence instead.
  confidence: z.number().default(0.8),
});

export const extractionSchema = z.object({
  facts: z.array(factSchema).default([]),
});

/** Batch variant: each fact also says which message it came from. */
export const batchExtractionSchema = z.object({
  facts: z
    .array(
      factSchema.extend({
        // Not .int(): Zod emits safe-integer minimum/maximum for it, which
        // the provider rejects the same way. Rounded at the point of use.
        message_index: z
          .number()
          .describe("Index of the message this fact came from"),
      }),
    )
    .default([]),
});

export type ExtractedFact = z.infer<typeof factSchema>;

/** Keeps confidence in 0-1, since the schema can't express the bound. */
export function clampConfidence(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0.8;
  return Math.min(1, Math.max(0, value));
}

/** Preceding turns shown to the extractor for context. */
const CONTEXT_MESSAGES = 5;

const NOISE_REGEX =
  /^(ok|lol|haha|heh|nice|thanks|thank you|yes|no|yep|nope|yeah|nah|sure|wow|bruh|bro|gg|true|same|fr|ikr|damn|aight|bet|salam|ws|wa'alaikumussalam|walaikumsalam)[\s!.?]*$/i;

const EMOJI_ONLY_REGEX = /^[\p{Emoji}\p{Emoji_Presentation}\s]+$/u;

/**
 * Pre-LLM filter to skip trivial messages that won't contain memorable facts.
 */
export function shouldExtractMemory(text: string, isBot: boolean): boolean {
  if (!text || text.length < 15) return false;
  if (isBot) return false;
  if (text.startsWith("/")) return false;
  if (NOISE_REGEX.test(text.trim())) return false;
  if (EMOJI_ONLY_REGEX.test(text.trim())) return false;
  return true;
}

/** Shared by both extraction paths, which previously kept copies that drifted. */
export const EXTRACTION_RULES = `Your job is to record durable facts **about the people in this community** — things worth recalling months later when someone asks "who knows about X?" or "what is Ali working on?".

Extract a fact ONLY when it is:
- About a person, the community, or a decision they made, AND
- Still true and useful months from now, AND
- Actually asserted — not asked, speculated about, or joked about.

Do NOT extract:
- **World news, articles, or links someone shared.** "Terabytes of credentials were leaked in a supply chain attack" is news, not a memory. That someone *shared* it is also not worth recording.
- **Industry commentary or opinions.** "Spending 1-2k on tokens is becoming a norm" is an observation about the world, not a fact about anyone.
- **Terminology musings or questions.** If the message asks something, or wonders aloud, there is no fact in it.
- **Technical trivia with no owner.** "128GB unified memory is soldered to the package" belongs in documentation, not memory.
- Greetings, small talk, jokes, reactions.

Good examples:
- "Faruq is moving his coding agents to exe.dev" — durable, about a person
- "Syafiq uses pi-memory as a repo-level knowledge extension" — durable, about a person
- "The community prefers Saturday meetups" — durable, about the community

Bad examples (do not extract):
- "Datadog rebuilt their Git serving infrastructure" — world news
- "Multi-model and multi-modal are used interchangeably" — terminology musing
- "Someone shared an article about open source devtools" — a link share

The \`subject\` must be the **name or @username of the person the fact is about**, exactly as it appears in the chat. If the fact is about the community as a whole, use "community". If you cannot name a specific person or the community, the fact almost certainly does not belong in memory — skip it.

Categories: person_fact, community_preference, decision, technical, event_related, general.
Prefer person_fact and community_preference. Use technical or general only when the fact is genuinely about a member's own work or setup.

Set confidence 0.6-1.0 based on how definitive the statement is.

Most messages contain nothing worth remembering. Returning an empty array is the correct answer far more often than not.`;

/** Live path: one message, with the preceding turns as context. */
export const EXTRACTION_PROMPT = `You maintain a long-term memory for MSOCIETY, a community of Muslim tech professionals. You are shown one message from their group chat, with the messages just before it for context.

${EXTRACTION_RULES}`;

/**
 * Backfill path: a run of consecutive messages, each one a candidate.
 *
 * The batch is its own context — the model sees the whole exchange rather than
 * a single line, which is strictly more information than the live path gets.
 * Each fact carries the index of the message it came from so it is stored
 * against the right source.
 */
export const BATCH_EXTRACTION_PROMPT = `You maintain a long-term memory for MSOCIETY, a community of Muslim tech professionals. You are shown a run of consecutive messages from their group chat, numbered from 0.

${EXTRACTION_RULES}

Read the whole exchange for context, but extract only facts the messages actually establish. Tag each fact with the index of the message it came from.`;

/**
 * Extract memories from a message using Haiku. Fire-and-forget.
 */
export async function extractMemories(
  text: string,
  senderName: string,
  senderUsername: string | null,
  senderTelegramId: number | null,
  chatId: string,
  messageId: number,
): Promise<void> {
  const senderLabel = senderUsername
    ? `${senderName} (@${senderUsername})`
    : senderName;

  // Without prior turns the extractor can't tell an assertion from a question,
  // or resolve pronouns — that's how "I guess they're the same?" became a fact.
  const priorTurns = await getMessageContext(chatId, messageId, CONTEXT_MESSAGES);
  const conversation = priorTurns.length
    ? priorTurns
        .map((m) => `${m.sender}: ${m.text}`)
        .join("\n")
    : "(no earlier messages)";

  const result = await aiService.generateObject(
    {
      model: aiService.models.fast,
      schema: extractionSchema,
      system: EXTRACTION_PROMPT,
      messages: [
        {
          role: "user",
          content:
            `Earlier in the conversation:\n${conversation}\n\n` +
            `--- Extract from THIS message only ---\n${senderLabel}: "${text}"`,
        },
      ],
      maxOutputTokens: 512,
    },
    {
      caller: "memory-extractor",
      telegramUserId: senderTelegramId,
      chatId,
      class: "background",
    },
  );

  // `aiService.generateObject` widens its result to `unknown` (its return type
  // drops generateObject's generic), so re-parse to recover the type. The SDK
  // has already validated against this schema.
  const { facts } = extractionSchema.parse(result.object);
  if (facts.length === 0) return;

  const senderNameLower = senderName.toLowerCase();
  const senderUsernameLower = senderUsername?.toLowerCase() ?? "";

  const memories: MemoryInput[] = [];
  for (const fact of facts) {
    const subjectLower = (fact.subject ?? "").toLowerCase();
    const isSender =
      subjectLower === senderNameLower ||
      subjectLower === senderUsernameLower ||
      subjectLower === "i" ||
      subjectLower === "me";

    // No fallback to the sender. `?? senderTelegramId` here once misattributed
    // 86% of the corpus — a shared news link became a fact about the sharer.
    // Null keeps the memory searchable but off anyone's profile.
    const subjectTelegramId = isSender
      ? senderTelegramId
      : await resolveSubjectTelegramId(fact.subject);

    memories.push({
      content: fact.content,
      category: fact.category,
      subject: fact.subject,
      subjectTelegramId,
      sourceChatId: chatId,
      sourceMessageId: messageId,
      confidence: clampConfidence(fact.confidence),
    });
  }

  await saveMemories(memories);
  console.log(
    `[memory-extractor] extracted ${memories.length} memories from message ${messageId}`,
  );
}

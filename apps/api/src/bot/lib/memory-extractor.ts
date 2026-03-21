import Anthropic from "@anthropic-ai/sdk";
import { env } from "../../env";
import { saveMemories, resolveSubjectTelegramId, type MemoryInput } from "../../services/memory.service";

const anthropic = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });

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

const EXTRACTION_PROMPT = `You extract noteworthy facts from group chat messages. Return a JSON array of facts, or an empty array if there are none worth remembering.

Each fact should be:
- A standalone statement (e.g. "Ali works at Stripe", "The community prefers Saturday meetups")
- Categorized as one of: person_fact, community_preference, decision, technical, event_related, general
- Attributed to a subject (who/what it's about)

Rules:
- Only extract facts that would be useful to recall later
- Skip greetings, small talk, jokes, and opinions unless they reveal something persistent
- Keep facts concise (one sentence)
- Set confidence 0.6-1.0 based on how definitive the statement is

Respond with ONLY a JSON array, no markdown fences:
[{"content": "...", "category": "...", "subject": "...", "confidence": 0.8}]
Or [] if nothing worth remembering.`;

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

  const response = await anthropic.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 256,
    messages: [
      {
        role: "user",
        content: `Message from ${senderLabel}:\n"${text}"`,
      },
    ],
    system: EXTRACTION_PROMPT,
  });

  const firstBlock = response.content[0];
  if (!firstBlock || firstBlock.type !== "text") return;

  let facts: Array<{
    content: string;
    category: string;
    subject: string;
    confidence?: number;
  }>;

  try {
    const jsonMatch = firstBlock.text.match(/\[[\s\S]*\]/);
    facts = JSON.parse(jsonMatch ? jsonMatch[0] : firstBlock.text);
  } catch {
    console.error("[memory-extractor] failed to parse response:", firstBlock.text);
    return;
  }

  if (!Array.isArray(facts) || facts.length === 0) return;

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

    const subjectTelegramId = isSender
      ? senderTelegramId
      : (await resolveSubjectTelegramId(fact.subject)) ?? senderTelegramId;

    memories.push({
      content: fact.content,
      category: fact.category,
      subject: fact.subject,
      subjectTelegramId,
      sourceChatId: chatId,
      sourceMessageId: messageId,
      confidence: fact.confidence ?? 0.8,
    });
  }

  await saveMemories(memories);
  console.log(
    `[memory-extractor] extracted ${memories.length} memories from message ${messageId}`,
  );
}

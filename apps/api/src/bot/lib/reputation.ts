const REPUTATION_KEYWORDS = ["thanks", "thank you", "jazakallah"];

interface ReactionEvent {
  fromTelegramId: string;
  messageId: string;
  chatId: string;
  emoji: string;
}

interface KeywordEvent {
  fromTelegramId: string;
  toTelegramId: string;
  messageId: string;
  chatId: string;
  text: string;
}

export async function processReaction(event: ReactionEvent): Promise<void> {
  try {
    // TODO: Call reputation service directly to record reputation event
    // The service will check if the emoji maps to a reputation trigger
    // and handle deduplication + self-voting checks
    console.log("Reputation reaction:", event);
  } catch (error) {
    console.error("Failed to process reputation reaction:", error);
  }
}

export async function processKeyword(event: KeywordEvent): Promise<void> {
  const lowerText = event.text.toLowerCase();

  const matchedKeyword = REPUTATION_KEYWORDS.find((kw) =>
    lowerText.includes(kw)
  );

  if (!matchedKeyword) return;

  try {
    // TODO: Call reputation service directly to record keyword-based reputation event
    console.log("Reputation keyword:", matchedKeyword, event);
  } catch (error) {
    console.error("Failed to process reputation keyword:", error);
  }
}

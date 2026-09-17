/** A transport-independent message used in conversation context. */
export interface ConversationMessage {
  id: number;
  text: string;
  from: string;
  at: string;
  replyToId?: number;
}

export interface ConversationContext {
  chatId: string;
  currentMessage: ConversationMessage;
  parentMessage?: Omit<ConversationMessage, "replyToId">;
  recentHistory: ConversationMessage[];
  metadata: { isGroupChat: boolean; topicId?: number; chatTitle?: string };
}

/** Metadata required to build a context from a Telegram update. */
export interface TelegramConversationMetadata {
  chatId: string;
  messageId: number;
  text?: string;
  from: string;
  at: string | Date | number;
  replyToId?: number;
  isGroupChat: boolean;
  topicId?: number;
  chatTitle?: string;
}

/** A reader for the specific-message mode of the `chat_history` tool. */
export type ChatHistoryFetcher = (messageId: number, chatId?: string) => Promise<ConversationMessage | null | undefined>;

function withoutReplyId(message: ConversationMessage): Omit<ConversationMessage, "replyToId"> {
  const { replyToId: _replyToId, ...parent } = message;
  return parent;
}

/**
 * Resolves a Telegram message's parent, checking the recent window first and
 * then using the specific-message `chat_history` lookup when necessary.
 * Unavailable parents resolve to null rather than being invented.
 */
export async function resolveReplyParent(
  message: Pick<ConversationMessage, "replyToId">,
  recentHistory: ConversationMessage[],
  fetchChatHistory?: ChatHistoryFetcher,
  chatId?: string,
): Promise<Omit<ConversationMessage, "replyToId"> | null> {
  const parentId = message.replyToId;
  if (parentId === undefined) return null;
  const inWindow = recentHistory.find((candidate) => candidate.id === parentId);
  if (inWindow) return withoutReplyId(inWindow);
  if (!fetchChatHistory || chatId === undefined) return null;
  try {
    const fetched = await fetchChatHistory(parentId, chatId);
    return fetched ? withoutReplyId(fetched) : null;
  } catch {
    return null;
  }
}

function normalizeAt(at: string | Date | number): string {
  if (at instanceof Date) return at.toISOString();
  if (typeof at === "number") return new Date(at < 10_000_000_000 ? at * 1000 : at).toISOString();
  return at;
}

/** Builds unified context and resolves its reply parent when one exists. */
export async function buildConversationContext(
  metadata: TelegramConversationMetadata,
  recentHistory: ConversationMessage[],
  fetchChatHistory?: ChatHistoryFetcher,
): Promise<ConversationContext> {
  const currentMessage: ConversationMessage = {
    id: metadata.messageId,
    text: metadata.text ?? "",
    from: metadata.from,
    at: normalizeAt(metadata.at),
    ...(metadata.replyToId === undefined ? {} : { replyToId: metadata.replyToId }),
  };
  const parentMessage = await resolveReplyParent(currentMessage, recentHistory, fetchChatHistory, metadata.chatId);
  return {
    chatId: metadata.chatId,
    currentMessage,
    ...(parentMessage ? { parentMessage } : {}),
    recentHistory,
    metadata: {
      isGroupChat: metadata.isGroupChat,
      ...(metadata.topicId === undefined ? {} : { topicId: metadata.topicId }),
      ...(metadata.chatTitle === undefined ? {} : { chatTitle: metadata.chatTitle }),
    },
  };
}

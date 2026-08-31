import { HISTORY_MESSAGE_LIMIT, HISTORY_WINDOW_MS } from "./chat-context";
import {
  BATCH_SIZE,
  extractBatch,
  type PendingMessage,
} from "./memory-extractor";
import { saveMemories } from "../../services/memory.service";
import { markMemoryExtracted } from "../../services/messages.service";

/**
 * Buffers a conversation's messages and extracts memories from the run rather
 * than one message at a time.
 *
 * Extraction used to fire per message. That reads each line without the
 * exchange around it, which is why it came back with nothing on 51% of calls
 * against the batched backfill's 13%, and why it wrote a fact per message where
 * one fact covers the whole thread.
 *
 * The delay this introduces costs nothing while the buffered messages are still
 * in the agent's own context: it can read the text directly, so a memory drawn
 * from it would be telling it what it can already see. Memory only has to
 * outlive that window. So the buffer holds until the messages are about to
 * leave it — see FLUSH_MARGIN.
 *
 * Two things it does not cover, both bounded by the flush window. Recall is
 * global while the agent's history is scoped to one chat and topic, so a fact
 * said in the group is not yet recallable from a DM, or from another topic,
 * until it flushes. And the buffer is process-local: anything unflushed at
 * shutdown stays unstamped, so the backfill picks it up on the next boot rather
 * than losing it.
 */

/**
 * How close to the edge of the agent's context to let a message get.
 *
 * Under 1 so a flush starts while the run is still visible, leaving room for
 * the model call itself to finish before the oldest message ages out.
 */
const FLUSH_MARGIN = 0.8;

/** Messages through the conversation before the run is flushed. */
export const FLUSH_AFTER_SEEN = Math.floor(HISTORY_MESSAGE_LIMIT * FLUSH_MARGIN);

/** Age of the oldest buffered message before the run is flushed. */
export const FLUSH_AFTER_MS = Math.floor(HISTORY_WINDOW_MS * FLUSH_MARGIN);

export interface BufferState {
  /** Buffered messages waiting to be read as a run. */
  pending: number;
  /** Messages through the conversation since the oldest buffered one. */
  seen: number;
  /** Age of the oldest buffered message. */
  oldestAgeMs: number;
}

export type FlushReason = "batch_full" | "context_pressure" | "context_age";

/**
 * Whether a buffered run should be read now. Pure — the caller counts.
 *
 * The two context reasons are the same rule from either end: a message leaves
 * the agent's sight when enough newer ones arrive, or when it gets old enough,
 * and either way the run has to be read before that happens. `batch_full` is
 * unrelated to context — it is the size of one model call.
 */
export function decideFlush(state: BufferState): FlushReason | null {
  if (state.pending === 0) return null;
  if (state.pending >= BATCH_SIZE) return "batch_full";
  if (state.seen >= FLUSH_AFTER_SEEN) return "context_pressure";
  if (state.oldestAgeMs >= FLUSH_AFTER_MS) return "context_age";
  return null;
}

export interface ObservedMessage extends PendingMessage {
  threadId: number | null;
  /**
   * False when the pure pre-filter rejected the message. It is not buffered,
   * but it still counts against the context window — 40 rejected messages push
   * a buffered one out of the agent's sight just as surely as 40 kept ones.
   */
  extractable: boolean;
}

interface Conversation {
  pending: PendingMessage[];
  /** Messages seen since `pending[0]`, extractable or not. */
  seen: number;
  oldestAt: number;
  timer: ReturnType<typeof setTimeout> | null;
  flushing: boolean;
}

const stateOf = (conv: Conversation, now: number): BufferState => ({
  pending: conv.pending.length,
  seen: conv.seen,
  oldestAgeMs: now - conv.oldestAt,
});

/**
 * Keyed by chat and forum topic, matching how the agent scopes its history —
 * a run in one topic is not context for a question in another.
 */
const conversations = new Map<string, Conversation>();

const keyOf = (chatId: string, threadId: number | null): string =>
  `${chatId}:${threadId ?? ""}`;

function clearTimer(conv: Conversation): void {
  if (conv.timer) {
    clearTimeout(conv.timer);
    conv.timer = null;
  }
}

/**
 * Take one message. Buffers it when there is a fact to be had, and flushes the
 * run once it is close to leaving the agent's context.
 */
export async function observeMessage(msg: ObservedMessage): Promise<void> {
  const key = keyOf(msg.chatId, msg.threadId);
  const conv = conversations.get(key);

  if (!msg.extractable) {
    // Nothing to extract, but it still ages whatever is buffered behind it.
    // Stamped now so the backfill does not pay a model call to agree.
    if (conv) conv.seen++;
    await markMemoryExtracted(msg.chatId, [msg.messageId]);
    if (conv && decideFlush(stateOf(conv, Date.now()))) await flush(key);
    return;
  }

  const now = Date.now();
  const target: Conversation = conv ?? {
    pending: [],
    seen: 0,
    oldestAt: now,
    timer: null,
    flushing: false,
  };
  if (!conv) conversations.set(key, target);

  target.pending.push(msg);
  target.seen++;

  // First of a fresh run: start the clock that bounds how long a conversation
  // too quiet to trigger anything else may sit on a fact.
  if (target.pending.length === 1) {
    target.oldestAt = now;
    if (!target.timer) {
      target.timer = setTimeout(() => {
        void flush(key);
      }, FLUSH_AFTER_MS);
    }
  }

  if (decideFlush(stateOf(target, now))) await flush(key);
}

/** Extract from everything buffered for one conversation. */
async function flush(key: string): Promise<void> {
  const conv = conversations.get(key);
  if (!conv || conv.flushing || conv.pending.length === 0) return;

  conv.flushing = true;
  const batch = conv.pending;
  conv.pending = [];
  conv.seen = 0;
  clearTimer(conv);

  try {
    const memories = await extractBatch(batch, "memory-extractor");
    if (memories.length > 0) await saveMemories(memories);

    // Stamped whether or not the run yielded anything, so a batch the model
    // found nothing in is not re-read later by the backfill.
    await markMemoryExtracted(
      batch[0]!.chatId,
      batch.map((m) => m.messageId),
    );

    console.log(
      `[memory-batch] ${key}: ${memories.length} memories from ${batch.length} message(s)`,
    );
  } catch (err) {
    // Deliberately left unstamped. The backfill selects on
    // `memory_extracted_at IS NULL`, so a failed run is retried there with the
    // same batching rather than dropped.
    console.error(`[memory-batch] ${key}: flush failed:`, err);
  } finally {
    conv.flushing = false;
    if (conv.pending.length === 0 && !conv.timer) conversations.delete(key);
  }
}

/** Flush every buffered conversation. For shutdown and for tests. */
export async function flushAllConversations(): Promise<void> {
  await Promise.all([...conversations.keys()].map((key) => flush(key)));
}

/** Test seam — the buffer is module state. */
export function resetConversationBuffers(): void {
  for (const conv of conversations.values()) clearTimer(conv);
  conversations.clear();
}

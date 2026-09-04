import { HISTORY_MESSAGE_LIMIT, HISTORY_WINDOW_MS } from "./chat-context";

/**
 * When a buffered run of messages should be read — the testable core.
 *
 * Deliberately free of database, env and AI-client imports, mirroring the
 * dm-access / group-access split. The buffer these numbers govern lives in
 * memory-batch.ts, which reaches services and therefore `env`; keeping the
 * decision here is what lets it be tested without a DATABASE_URL or an API
 * key, rather than passing only because the runner happened to start in a
 * directory with a .env in it.
 */

/** Messages per model call. Also the size of the context window the model sees. */
export const BATCH_SIZE = 10;

/**
 * How close to the edge of the agent's context to let a message get.
 *
 * Under 1 so a flush starts while the run is still visible, leaving room for
 * the model call itself to finish before the oldest message ages out.
 */
const FLUSH_MARGIN = 0.8;

/** Messages through the conversation before the run is flushed. */
export const FLUSH_AFTER_SEEN = Math.floor(
  HISTORY_MESSAGE_LIMIT * FLUSH_MARGIN,
);

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

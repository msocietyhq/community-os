import { describe, expect, it } from "bun:test";
import {
  decideFlush,
  FLUSH_AFTER_MS,
  FLUSH_AFTER_SEEN,
  type BufferState,
} from "./memory-batch";
import { BATCH_SIZE } from "./memory-extractor";
import { HISTORY_MESSAGE_LIMIT, HISTORY_WINDOW_MS } from "./chat-context";

const state = (over: Partial<BufferState> = {}): BufferState => ({
  pending: 1,
  seen: 1,
  oldestAgeMs: 0,
  ...over,
});

describe("decideFlush", () => {
  it("holds a run that is nowhere near any bound", () => {
    expect(decideFlush(state({ pending: 2, seen: 3 }))).toBeNull();
  });

  it("never flushes an empty buffer, however much has gone past it", () => {
    expect(
      decideFlush({
        pending: 0,
        seen: FLUSH_AFTER_SEEN * 2,
        oldestAgeMs: FLUSH_AFTER_MS * 2,
      }),
    ).toBeNull();
  });

  it("flushes a full batch, which is the model call's own limit", () => {
    expect(decideFlush(state({ pending: BATCH_SIZE, seen: BATCH_SIZE }))).toBe(
      "batch_full",
    );
  });

  it("flushes when traffic is about to push the run out of context", () => {
    expect(decideFlush(state({ pending: 2, seen: FLUSH_AFTER_SEEN }))).toBe(
      "context_pressure",
    );
  });

  it("counts messages it did not buffer toward that pressure", () => {
    // One fact behind a wall of "ok"/"lol": those are never extracted, but they
    // push the buffered message out of the agent's sight all the same.
    expect(decideFlush(state({ pending: 1, seen: FLUSH_AFTER_SEEN }))).toBe(
      "context_pressure",
    );
  });

  it("flushes a conversation too quiet to trigger anything else", () => {
    expect(
      decideFlush(state({ pending: 1, seen: 1, oldestAgeMs: FLUSH_AFTER_MS })),
    ).toBe("context_age");
  });

  it("prefers the batch limit when several reasons apply at once", () => {
    expect(
      decideFlush({
        pending: BATCH_SIZE,
        seen: FLUSH_AFTER_SEEN,
        oldestAgeMs: FLUSH_AFTER_MS,
      }),
    ).toBe("batch_full");
  });
});

describe("flush bounds against the agent's context window", () => {
  // The whole point of the delay is that a buffered message is still readable
  // in the prompt. If either bound reached the context limit, a run could be
  // extracted from messages the agent had already lost.
  it("starts flushing before the message limit is reached", () => {
    expect(FLUSH_AFTER_SEEN).toBeLessThan(HISTORY_MESSAGE_LIMIT);
  });

  it("starts flushing before the window has elapsed", () => {
    expect(FLUSH_AFTER_MS).toBeLessThan(HISTORY_WINDOW_MS);
  });

  it("leaves room for the model call itself to finish", () => {
    // A minute of margin at least, so a slow call still lands inside the window.
    expect(HISTORY_WINDOW_MS - FLUSH_AFTER_MS).toBeGreaterThan(60_000);
  });

  it("fills a batch before context pressure does, in a busy chat", () => {
    expect(BATCH_SIZE).toBeLessThan(FLUSH_AFTER_SEEN);
  });
});

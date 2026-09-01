import { describe, expect, test } from "bun:test";
import {
  shouldResume,
  isExpired,
  PENDING_QUESTION_TTL_MS,
  type PendingQuestion,
} from "./pending-question";

const NOW = 1_800_000_000_000;

const question = (over: Partial<PendingQuestion> = {}): PendingQuestion => ({
  questionMessageId: 500,
  askedTelegramId: 42,
  askedAt: NOW,
  messageThreadId: null,
  ...over,
});

const incoming = (over: Partial<Parameters<typeof shouldResume>[1]> = {}) => ({
  fromTelegramId: 42 as number | null,
  messageThreadId: null as number | null,
  at: NOW + 1000,
  ...over,
});

describe("shouldResume", () => {
  test("the asked member answering shortly after resumes", () => {
    expect(shouldResume(question(), incoming())).toBe(true);
  });

  test("no outstanding question means no resume", () => {
    expect(shouldResume(undefined, incoming())).toBe(false);
  });

  /** Sessions are per-chat, so without this anyone could consume the slot. */
  test("a different member answering does not resume", () => {
    expect(shouldResume(question(), incoming({ fromTelegramId: 77 }))).toBe(
      false,
    );
  });

  test("an unidentifiable sender does not resume", () => {
    expect(shouldResume(question(), incoming({ fromTelegramId: null }))).toBe(
      false,
    );
  });

  test("an answer in a different forum topic does not resume", () => {
    expect(
      shouldResume(
        question({ messageThreadId: 112892 }),
        incoming({ messageThreadId: null }),
      ),
    ).toBe(false);
    expect(
      shouldResume(
        question({ messageThreadId: null }),
        incoming({ messageThreadId: 112892 }),
      ),
    ).toBe(false);
  });

  test("same topic resumes", () => {
    expect(
      shouldResume(
        question({ messageThreadId: 112892 }),
        incoming({ messageThreadId: 112892 }),
      ),
    ).toBe(true);
  });

  test("an answer past the window does not resume", () => {
    expect(
      shouldResume(
        question(),
        incoming({ at: NOW + PENDING_QUESTION_TTL_MS + 1 }),
      ),
    ).toBe(false);
  });

  test("the window boundary is inclusive", () => {
    expect(
      shouldResume(question(), incoming({ at: NOW + PENDING_QUESTION_TTL_MS })),
    ).toBe(true);
  });

  test("answering in the same millisecond resumes", () => {
    expect(shouldResume(question(), incoming({ at: NOW }))).toBe(true);
  });

  /** Clock skew shouldn't make a future-stamped question resumable forever. */
  test("a message stamped before the question does not resume", () => {
    expect(shouldResume(question(), incoming({ at: NOW - 1 }))).toBe(false);
  });

  test("the window is configurable", () => {
    expect(shouldResume(question(), incoming({ at: NOW + 50 }), 10)).toBe(
      false,
    );
    expect(shouldResume(question(), incoming({ at: NOW + 5 }), 10)).toBe(true);
  });
});

describe("isExpired", () => {
  test("absent question is not expired", () => {
    expect(isExpired(undefined, NOW)).toBe(false);
  });

  test("fresh question is not expired", () => {
    expect(isExpired(question(), NOW + 1000)).toBe(false);
  });

  test("question past the window is expired", () => {
    expect(isExpired(question(), NOW + PENDING_QUESTION_TTL_MS + 1)).toBe(true);
  });

  test("exactly at the boundary is not yet expired", () => {
    expect(isExpired(question(), NOW + PENDING_QUESTION_TTL_MS)).toBe(false);
  });

  test("expiry and resume agree at the boundary", () => {
    const at = NOW + PENDING_QUESTION_TTL_MS;
    expect(shouldResume(question(), incoming({ at }))).toBe(true);
    expect(isExpired(question(), at)).toBe(false);
  });
});

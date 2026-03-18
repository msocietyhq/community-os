import { describe, expect, test } from "bun:test";
import {
  buildTelegramMeta,
  buildEnrichedQuery,
  getRecentHistory,
  ONE_HOUR_MS,
  MAX_HISTORY,
} from "./chat-context";
import type { ChatTurn } from "../types";
import type { ModelMessage } from "ai";

// ─── buildTelegramMeta ────────────────────────────────────────────────────────

describe("buildTelegramMeta", () => {
  const BOT_ID = 999;
  const baseMsg = { message_id: 1, date: 1700000000 };
  const baseFrom = {
    id: 42,
    first_name: "Aziz",
    last_name: "S",
    username: "aziz_sg",
  };

  test("plain message (no reply) → replyTo is undefined", () => {
    const meta = buildTelegramMeta(baseMsg, baseFrom, "private", BOT_ID);
    expect(meta.replyTo).toBeUndefined();
    expect(meta.from.username).toBe("aziz_sg");
    expect(meta.chatType).toBe("private");
  });

  test("reply to another user → replyTo populated", () => {
    const msg = {
      ...baseMsg,
      reply_to_message: {
        message_id: 5,
        date: 1699999900,
        from: { id: 77, first_name: "Hafiz", username: "hafiz_dev" },
        text: "Hello world",
      },
    };
    const meta = buildTelegramMeta(msg, baseFrom, "group", BOT_ID);
    expect(meta.replyTo).toBeDefined();
    expect(meta.replyTo?.from?.id).toBe(77);
    expect(meta.replyTo?.text).toBe("Hello world");
  });

  test("reply to the bot → replyTo omitted", () => {
    const msg = {
      ...baseMsg,
      reply_to_message: {
        message_id: 3,
        date: 1699999800,
        from: { id: BOT_ID, first_name: "BotName" },
        text: "I can help you with that.",
      },
    };
    const meta = buildTelegramMeta(msg, baseFrom, "group", BOT_ID);
    expect(meta.replyTo).toBeUndefined();
  });

  test("no username → firstName is accessible via from.firstName", () => {
    const from = { id: 55, first_name: "Bilal" };
    const meta = buildTelegramMeta(baseMsg, from, "private", BOT_ID);
    expect(meta.from.username).toBeUndefined();
    expect(meta.from.firstName).toBe("Bilal");
  });
});

// ─── buildEnrichedQuery ───────────────────────────────────────────────────────

describe("buildEnrichedQuery", () => {
  const baseDate = Math.floor(new Date("2026-03-18T14:32:00Z").getTime() / 1000);

  test("private chat, no reply → header with sender name, no reply info", () => {
    const meta = buildTelegramMeta(
      { message_id: 1, date: baseDate },
      { id: 1, first_name: "Aziz", username: "aziz_sg" },
      "private",
      0,
    );
    const result = buildEnrichedQuery("What is the next event?", meta);
    expect(result).toContain("@aziz_sg");
    expect(result).toContain("What is the next event?");
    expect(result).not.toContain("replying to");
  });

  test("group chat with reply → includes reply chain info", () => {
    const meta = buildTelegramMeta(
      {
        message_id: 2,
        date: baseDate,
        reply_to_message: {
          message_id: 1,
          date: baseDate - 120,
          from: { id: 77, first_name: "Hafiz", username: "hafiz_dev" },
          text: "Can someone help?",
        },
      },
      { id: 1, first_name: "Aziz", username: "aziz_sg" },
      "group",
      0,
    );
    const result = buildEnrichedQuery("@bot sure", meta);
    expect(result).toContain("replying to");
    expect(result).toContain("@hafiz_dev");
    expect(result).toContain("Can someone help?");
  });

  test("long reply text → truncated to max 120 chars + ellipsis", () => {
    const longText = "A".repeat(200);
    const meta = buildTelegramMeta(
      {
        message_id: 2,
        date: baseDate,
        reply_to_message: {
          message_id: 1,
          date: baseDate - 60,
          from: { id: 77, first_name: "Hafiz" },
          text: longText,
        },
      },
      { id: 1, first_name: "Aziz" },
      "group",
      0,
    );
    const result = buildEnrichedQuery("ok", meta);
    // Should contain truncated text with ellipsis
    expect(result).toContain("…");
    // The reply text in the header should not exceed 120 + ellipsis
    const headerMatch = result.match(/"([^"]+)"/);
    expect(headerMatch).not.toBeNull();
    const capturedText = headerMatch?.[1] ?? "";
    expect(capturedText.length).toBeLessThanOrEqual(121); // 120 chars + ellipsis char
  });

  test("user without username → firstName used in header", () => {
    const meta = buildTelegramMeta(
      { message_id: 1, date: baseDate },
      { id: 1, first_name: "Bilal" },
      "private",
      0,
    );
    const result = buildEnrichedQuery("hi", meta);
    expect(result).toContain("Bilal");
    expect(result).not.toContain("@");
  });
});

// ─── getRecentHistory ─────────────────────────────────────────────────────────

describe("getRecentHistory", () => {
  const now = Date.now();

  function makeTurn(ageMs: number, msgCount = 2): ChatTurn {
    const messages: ModelMessage[] = Array.from({ length: msgCount }, (_, i) => ({
      role: i % 2 === 0 ? "user" : "assistant",
      content: `message ${i}`,
    }));
    return { timestamp: now - ageMs, messages };
  }

  test("empty turns → returns empty arrays", () => {
    const { recentTurns, chatHistory } = getRecentHistory([], now, ONE_HOUR_MS, MAX_HISTORY);
    expect(recentTurns).toHaveLength(0);
    expect(chatHistory).toHaveLength(0);
  });

  test("all turns within window → all returned", () => {
    const turns = [makeTurn(10_000), makeTurn(20_000), makeTurn(30_000)];
    const { recentTurns, chatHistory } = getRecentHistory(turns, now, ONE_HOUR_MS, MAX_HISTORY);
    expect(recentTurns).toHaveLength(3);
    expect(chatHistory).toHaveLength(6); // 3 turns × 2 messages
  });

  test("some turns expired → expired ones dropped, recent kept", () => {
    const turns = [
      makeTurn(30 * 60 * 1000),       // 30 min ago — within window
      makeTurn(90 * 60 * 1000),       // 90 min ago — expired
    ];
    const { recentTurns, chatHistory } = getRecentHistory(turns, now, ONE_HOUR_MS, MAX_HISTORY);
    expect(recentTurns).toHaveLength(1);
    expect(chatHistory).toHaveLength(2);
  });

  test("all turns expired → empty arrays", () => {
    const turns = [makeTurn(2 * ONE_HOUR_MS), makeTurn(3 * ONE_HOUR_MS)];
    const { recentTurns, chatHistory } = getRecentHistory(turns, now, ONE_HOUR_MS, MAX_HISTORY);
    expect(recentTurns).toHaveLength(0);
    expect(chatHistory).toHaveLength(0);
  });

  test("flattened messages exceed maxMessages → sliced to last N", () => {
    // 6 turns × 3 messages = 18 messages; cap at 10
    const turns = Array.from({ length: 6 }, () => makeTurn(5_000, 3));
    const { chatHistory } = getRecentHistory(turns, now, ONE_HOUR_MS, 10);
    expect(chatHistory).toHaveLength(10);
  });

  test("chatHistory.length correctly indexes into updatedHistory for new-turn extraction", () => {
    const turns = [makeTurn(5_000, 4)]; // 4 existing messages
    const { chatHistory } = getRecentHistory(turns, now, ONE_HOUR_MS, MAX_HISTORY);
    expect(chatHistory).toHaveLength(4);

    // Simulate agent returning existing + 2 new messages
    const simulatedUpdatedHistory: ModelMessage[] = [
      ...chatHistory,
      { role: "user", content: "new question" },
      { role: "assistant", content: "new answer" },
    ];
    const newTurnMessages = simulatedUpdatedHistory.slice(chatHistory.length);
    expect(newTurnMessages).toHaveLength(2);
    // biome-ignore lint/style/noNonNullAssertion: length asserted above
    expect(newTurnMessages[0]!.content).toBe("new question");
    // biome-ignore lint/style/noNonNullAssertion: length asserted above
    expect(newTurnMessages[1]!.content).toBe("new answer");
  });
});

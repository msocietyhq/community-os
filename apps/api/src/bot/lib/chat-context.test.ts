import { describe, expect, test } from "bun:test";
import {
  buildTelegramMeta,
  buildEnrichedQuery,
  buildMessagesFromHistory,
} from "./chat-context";
import type { ModelMessage } from "ai";
import type { telegramMessages } from "../../db/schema/bot";

type TelegramMessageRow = typeof telegramMessages.$inferSelect;

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

  test("reply to the bot → replyTo IS populated (no longer filtered)", () => {
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
    expect(meta.replyTo).toBeDefined();
    expect(meta.replyTo?.from?.id).toBe(BOT_ID);
    expect(meta.replyTo?.text).toBe("I can help you with that.");
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

// ─── buildMessagesFromHistory ────────────────────────────────────────────────

describe("buildMessagesFromHistory", () => {
  const BOT_USER_ID = 999;

  function makeRow(overrides: Partial<TelegramMessageRow>): TelegramMessageRow {
    return {
      chatId: "-100123",
      chatType: "supergroup",
      messageId: 1,
      messageThreadId: null,
      isTopicMessage: null,
      isAutomaticForward: null,
      fromUserId: 42,
      fromFirstName: "Aziz",
      fromLastName: null,
      fromUsername: "aziz_sg",
      fromIsBot: false,
      fromIsPremium: null,
      fromLanguageCode: null,
      senderChatId: null,
      senderChatUsername: null,
      senderChatTitle: null,
      authorSignature: null,
      text: "hello",
      caption: null,
      mediaType: null,
      entities: null,
      date: new Date("2026-03-18T14:30:00Z"),
      createdAt: new Date("2026-03-18T14:30:00Z"),
      ...overrides,
    } as TelegramMessageRow;
  }

  test("human messages → user role with sender info, date on first message only (same day)", () => {
    const rows = [
      makeRow({ messageId: 1, fromUserId: 42, fromUsername: "aziz_sg", text: "hello" }),
      makeRow({ messageId: 2, fromUserId: 77, fromUsername: null, fromFirstName: "Hafiz", text: "hey there" }),
    ];
    const result = buildMessagesFromHistory(rows, BOT_USER_ID, {});
    expect(result).toHaveLength(2);
    expect(result[0]?.role).toBe("user");
    expect(result[0]?.content).toContain("@aziz_sg");
    expect(result[0]?.content).toContain("hello");
    // First message includes date
    expect(result[0]?.content).toContain("18 Mar 2026");
    expect(result[1]?.role).toBe("user");
    expect(result[1]?.content).toContain("Hafiz");
    expect(result[1]?.content).toContain("hey there");
    // Same day — no date
    expect(result[1]?.content).not.toContain("Mar");
  });

  test("bot message with matching aiResponses → expands stored messages", () => {
    // Simulate real AI SDK response messages (tool call chain + final text)
    const storedMessages = [
      { role: "assistant", content: "thinking..." },
      { role: "assistant", content: "processing..." },
      { role: "assistant", content: "No events found." },
    ] as ModelMessage[];
    const rows = [
      makeRow({ messageId: 10, fromUserId: BOT_USER_ID, fromIsBot: true, text: "No events found." }),
    ];
    const result = buildMessagesFromHistory(rows, BOT_USER_ID, { 10: storedMessages });
    expect(result).toHaveLength(3);
    expect(result[0]?.role).toBe("assistant");
    expect(result[2]?.role).toBe("assistant");
    expect(result[2]?.content).toBe("No events found.");
  });

  test("bot message without aiResponses → fallback to assistant text", () => {
    const rows = [
      makeRow({ messageId: 10, fromUserId: BOT_USER_ID, fromIsBot: true, text: "Sure, I can help!" }),
    ];
    const result = buildMessagesFromHistory(rows, BOT_USER_ID, {});
    expect(result).toHaveLength(1);
    expect(result[0]?.role).toBe("assistant");
    expect(result[0]?.content).toBe("Sure, I can help!");
  });

  test("chronological ordering maintained", () => {
    const rows = [
      makeRow({ messageId: 1, fromUserId: 42, text: "question 1", date: new Date("2026-03-18T14:30:00Z") }),
      makeRow({ messageId: 2, fromUserId: BOT_USER_ID, text: "answer 1", date: new Date("2026-03-18T14:30:05Z") }),
      makeRow({ messageId: 3, fromUserId: 42, text: "question 2", date: new Date("2026-03-18T14:31:00Z") }),
    ];
    const result = buildMessagesFromHistory(rows, BOT_USER_ID, {});
    expect(result).toHaveLength(3);
    expect(result[0]?.role).toBe("user");
    expect(result[1]?.role).toBe("assistant");
    expect(result[2]?.role).toBe("user");
  });

  test("date included when day changes between messages", () => {
    const rows = [
      makeRow({ messageId: 1, fromUserId: 42, text: "evening msg", date: new Date("2026-03-17T23:50:00Z") }),
      makeRow({ messageId: 2, fromUserId: 77, fromFirstName: "Hafiz", fromUsername: null, text: "morning msg", date: new Date("2026-03-18T08:10:00Z") }),
    ];
    const result = buildMessagesFromHistory(rows, BOT_USER_ID, {});
    expect(result).toHaveLength(2);
    // First message gets date
    expect(result[0]?.content).toContain("17 Mar 2026");
    // Second message on different day also gets date
    expect(result[1]?.content).toContain("18 Mar 2026");
  });

  test("empty content rows are skipped for human messages", () => {
    const rows = [
      makeRow({ messageId: 1, fromUserId: 42, text: null, caption: null, mediaType: null }),
    ];
    const result = buildMessagesFromHistory(rows, BOT_USER_ID, {});
    expect(result).toHaveLength(0);
  });

  test("media-only human message → uses media type placeholder", () => {
    const rows = [
      makeRow({ messageId: 1, fromUserId: 42, text: null, caption: null, mediaType: "photo" }),
    ];
    const result = buildMessagesFromHistory(rows, BOT_USER_ID, {});
    expect(result).toHaveLength(1);
    expect(result[0]?.content).toContain("[photo]");
  });
});

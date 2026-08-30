import { describe, expect, spyOn, test } from "bun:test";
import type { ModelMessage } from "ai";
import {
  buildAgentContext,
  extractMentionedSubjects,
  formatMemoryAge,
  MAX_INJECTED_MEMORIES,
  type ContextMemory,
  type MemoryRecaller,
} from "./context";

const NOW = new Date("2026-08-20T09:00:00Z");
const SDL = "type Query { events: [Event!]! }";

function makeMemory(overrides: Partial<ContextMemory> = {}): ContextMemory {
  return {
    id: "mem-1",
    content: "Ali works at Stripe",
    category: "person_fact",
    subject: "Ali",
    confidence: 0.8,
    similarity: 0.62,
    createdAt: new Date("2026-08-18T09:00:00Z"),
    ...overrides,
  };
}

interface RecallerCalls {
  semantic: { query: string; limit: number }[];
  bySubject: { telegramId: number; limit: number }[];
  resolveSubject: string[];
}

function makeRecaller(
  responses: {
    semantic?: ContextMemory[] | (() => Promise<ContextMemory[]>);
    bySubject?: ContextMemory[];
    resolveSubject?: Record<string, number>;
  } = {},
): { recaller: MemoryRecaller; calls: RecallerCalls } {
  const calls: RecallerCalls = { semantic: [], bySubject: [], resolveSubject: [] };

  const recaller: MemoryRecaller = {
    async semantic(query, limit) {
      calls.semantic.push({ query, limit });
      const s = responses.semantic;
      if (typeof s === "function") return s();
      return s ?? [];
    },
    async bySubject(telegramId, limit) {
      calls.bySubject.push({ telegramId, limit });
      return responses.bySubject ?? [];
    },
    async resolveSubject(name) {
      calls.resolveSubject.push(name);
      return responses.resolveSubject?.[name] ?? null;
    },
  };

  return { recaller, calls };
}

function baseInput(overrides = {}) {
  return {
    query: "what time is the next meetup?",
    enrichedQuery:
      "[20 Aug 2026, 17:00 | @aziz_sg | chat_id: -100123]\nwhat time is the next meetup?",
    chatHistory: [] as ModelMessage[],
    senderTelegramId: 42 as number | null,
    schemaSDL: SDL,
    runningModel: "anthropic/haiku-4-5 (Haiku 4.5)",
    now: NOW,
    ...overrides,
  };
}

// ─── formatMemoryAge ──────────────────────────────────────────────────────────

describe("formatMemoryAge", () => {
  const ago = (days: number) =>
    new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000);

  test.each([
    [0, "today"],
    [1, "yesterday"],
    [5, "5 days ago"],
    [13, "13 days ago"],
    [14, "2 weeks ago"],
    [30, "4 weeks ago"],
    [60, "2 months ago"],
    [120, "4 months ago"],
    [400, "1 year ago"],
    [800, "2 years ago"],
  ])("%i days old → %s", (days, expected) => {
    expect(formatMemoryAge(ago(days as number), NOW)).toBe(expected);
  });

  test("future timestamps read as today rather than negative", () => {
    const future = new Date(NOW.getTime() + 60_000);
    expect(formatMemoryAge(future, NOW)).toBe("today");
  });
});

// ─── extractMentionedSubjects ─────────────────────────────────────────────────

describe("extractMentionedSubjects", () => {
  test("finds @mentions in the current query", () => {
    expect(extractMentionedSubjects([], "does @hafiz_dev know about this?")).toEqual(
      ["hafiz_dev"],
    );
  });

  test("finds @mentions in the body of history messages", () => {
    const history: ModelMessage[] = [
      {
        role: "user",
        content: '<msg from="@aziz_sg" at="18 Mar 2026 14:30">\nhas @hafiz_dev seen this?\n</msg>',
      },
    ];
    expect(extractMentionedSubjects(history, "hello")).toEqual(["hafiz_dev"]);
  });

  /**
   * Speaking in the last hour is not the same as being mentioned — envelope
   * attributes must not be scanned, or every participant gets treated as a
   * subject and crowds out real mentions.
   */
  test("ignores the sender name in the envelope attributes", () => {
    const history: ModelMessage[] = [
      { role: "user", content: '<msg from="@aziz_sg" at="18 Mar 2026 14:30">\nhello everyone\n</msg>' },
      { role: "user", content: '<msg from="@hafiz_dev" at="14:31">\nsalam\n</msg>' },
    ];
    expect(extractMentionedSubjects(history, "who is around?")).toEqual([]);
  });

  /** Being replied to is not being mentioned. */
  test("ignores the reply target in the envelope attributes", () => {
    const history: ModelMessage[] = [
      {
        role: "user",
        content:
          '<msg from="@aziz_sg" at="14:30" replying-to="@hafiz_dev" replying-to-at="14:28">\non it\n</msg>',
      },
    ];
    expect(extractMentionedSubjects(history, "thanks")).toEqual([]);
  });

  /** A quoted parent is context, not something the sender said or mentioned. */
  test("ignores @mentions inside a quoted parent", () => {
    const history: ModelMessage[] = [
      {
        role: "user",
        content:
          '<msg from="@aziz_sg" at="14:30" replying-to="@hafiz_dev" reply-id="99">\n<quoted>ask @someone_else about it</quoted>\nwill do\n</msg>',
      },
    ];
    expect(extractMentionedSubjects(history, "ok")).toEqual([]);
  });

  test("ignores assistant messages", () => {
    const history: ModelMessage[] = [
      { role: "assistant", content: "I checked with @someone_else for you." },
    ];
    expect(extractMentionedSubjects(history, "thanks")).toEqual([]);
  });

  test("lowercases and de-duplicates repeated mentions", () => {
    const history: ModelMessage[] = [
      { role: "user", content: '<msg from="@a" at="14:30">\nping @Hafiz_Dev\n</msg>' },
    ];
    expect(extractMentionedSubjects(history, "@hafiz_dev again")).toEqual([
      "hafiz_dev",
    ]);
  });

  /** Regression: the old `From: Name` branch matched nothing in live chat. */
  test("does not treat 'From: Name' text as a mention", () => {
    expect(extractMentionedSubjects([], "From: Hafiz")).toEqual([]);
  });

  test("no mentions → empty array", () => {
    expect(extractMentionedSubjects([], "what time is the meetup?")).toEqual([]);
  });
});

// ─── buildAgentContext ────────────────────────────────────────────────────────

describe("buildAgentContext", () => {
  test("cold start — no memories, no history", async () => {
    const { recaller } = makeRecaller();
    const ctx = await buildAgentContext(baseInput({ senderTelegramId: null }), recaller);

    expect(ctx.memories).toEqual([]);
    expect(ctx.system).not.toContain("## Relevant Memories");
    expect(ctx.messages).toHaveLength(1);
    expect(ctx.messages[0]?.role).toBe("user");
  });

  /**
   * Regression: retrieval used to run on the header-prefixed query, which
   * dropped every hit for 3 of 5 sample questions and matched on the sender's
   * own username instead of what they asked.
   */
  test("retrieval uses the raw query, not the enriched one", async () => {
    const { recaller, calls } = makeRecaller();
    await buildAgentContext(baseInput(), recaller);

    expect(calls.semantic).toHaveLength(1);
    expect(calls.semantic[0]?.query).toBe("what time is the next meetup?");
    expect(calls.semantic[0]?.query).not.toContain("chat_id");
    expect(calls.semantic[0]?.query).not.toContain("@aziz_sg");
  });

  test("the model receives the enriched query, not the raw one", async () => {
    const { recaller } = makeRecaller();
    const ctx = await buildAgentContext(baseInput(), recaller);

    const last = ctx.messages.at(-1);
    expect(last?.role).toBe("user");
    expect(last?.content).toContain("chat_id: -100123");
    expect(last?.content).toContain("@aziz_sg");
  });

  test("chat history is preserved ahead of the current turn", async () => {
    const history: ModelMessage[] = [
      { role: "user", content: "[14:30 @aziz_sg]\nsalam" },
      { role: "assistant", content: "Wa'alaikumussalam!" },
    ];
    const { recaller } = makeRecaller();
    const ctx = await buildAgentContext(baseInput({ chatHistory: history }), recaller);

    expect(ctx.messages).toHaveLength(3);
    expect(ctx.messages[0]?.content).toBe("[14:30 @aziz_sg]\nsalam");
    expect(ctx.messages[1]?.role).toBe("assistant");
    expect(ctx.messages[2]?.content).toContain("what time is the next meetup?");
  });

  test("semantic memories render with age, confidence and match score", async () => {
    const { recaller } = makeRecaller({
      semantic: [
        makeMemory({
          content: "Ashiqurrah is responsible for planning the next meetup",
          subject: "Ashiqurrah",
          confidence: 0.75,
          similarity: 0.54,
          createdAt: new Date("2026-04-09T00:00:00Z"),
        }),
      ],
    });
    const ctx = await buildAgentContext(baseInput({ senderTelegramId: null }), recaller);

    expect(ctx.system).toContain("## Relevant Memories");
    expect(ctx.system).toContain(
      "- [person_fact · learned 4 months ago · confidence 0.75 · match 0.54] Ashiqurrah is responsible for planning the next meetup (about: Ashiqurrah)",
    );
  });

  /**
   * Retrieval deliberately runs a low similarity floor, so irrelevant hits are
   * expected. The model is told to judge them rather than trust the list.
   */
  test("semantic hits are labelled as possibly irrelevant", async () => {
    const { recaller } = makeRecaller({ semantic: [makeMemory()] });
    const ctx = await buildAgentContext(baseInput({ senderTelegramId: null }), recaller);

    expect(ctx.system).toContain("### Possibly relevant");
    expect(ctx.system).toContain("silently ignore the ones");
    expect(ctx.system).toContain("Never bend an answer to use a memory");
  });

  test("subject memories are listed separately and carry no match score", async () => {
    const { recaller } = makeRecaller({
      bySubject: [makeMemory({ id: "s1", content: "Aziz organises the meetups" })],
    });
    const ctx = await buildAgentContext(baseInput({ senderTelegramId: 42 }), recaller);

    expect(ctx.system).toContain("### About people in this conversation");
    expect(ctx.system).toContain("Aziz organises the meetups");
    expect(ctx.system).not.toContain("· match");
    expect(ctx.system).not.toContain("### Possibly relevant");
  });

  test("a memory found by both paths is filed under the subject section", async () => {
    const shared = makeMemory({ id: "shared" });
    const { recaller } = makeRecaller({ semantic: [shared], bySubject: [shared] });
    const ctx = await buildAgentContext(baseInput({ senderTelegramId: 42 }), recaller);

    expect(ctx.memories).toHaveLength(1);
    expect(ctx.memories[0]?.source).toBe("subject");
    expect(ctx.system).not.toContain("### Possibly relevant");
  });

  test("memory section warns the model about stale and low-confidence facts", async () => {
    const { recaller } = makeRecaller({ semantic: [makeMemory()] });
    const ctx = await buildAgentContext(baseInput(), recaller);

    expect(ctx.system).toContain("may be out of date");
    expect(ctx.system).toContain("below 0.7 confidence");
  });

  test("a memory with no subject omits the 'about' suffix", async () => {
    const { recaller } = makeRecaller({
      semantic: [makeMemory({ subject: null, content: "The venue has free parking" })],
    });
    const ctx = await buildAgentContext(baseInput(), recaller);

    expect(ctx.system).toContain("The venue has free parking");
    expect(ctx.system).not.toContain("(about:");
  });

  test("sender memories are fetched when the sender is known", async () => {
    const { recaller, calls } = makeRecaller();
    await buildAgentContext(baseInput({ senderTelegramId: 42 }), recaller);

    expect(calls.bySubject).toEqual([{ telegramId: 42, limit: 5 }]);
  });

  test("sender memories are skipped for an unknown sender", async () => {
    const { recaller, calls } = makeRecaller();
    await buildAgentContext(baseInput({ senderTelegramId: null }), recaller);

    expect(calls.bySubject).toEqual([]);
  });

  test("@mentioned members are resolved and their memories recalled", async () => {
    const { recaller, calls } = makeRecaller({
      resolveSubject: { hafiz_dev: 77 },
      bySubject: [makeMemory({ id: "mem-hafiz", content: "Hafiz runs the study circle" })],
    });
    const ctx = await buildAgentContext(
      baseInput({ query: "is @hafiz_dev coming?", senderTelegramId: null }),
      recaller,
    );

    expect(calls.resolveSubject).toEqual(["hafiz_dev"]);
    expect(calls.bySubject).toEqual([{ telegramId: 77, limit: 3 }]);
    expect(ctx.system).toContain("Hafiz runs the study circle");
  });

  test("unresolvable mentions are skipped without error", async () => {
    const { recaller, calls } = makeRecaller({ resolveSubject: {} });
    const ctx = await buildAgentContext(
      baseInput({ query: "is @nobody_here coming?", senderTelegramId: null }),
      recaller,
    );

    expect(calls.resolveSubject).toEqual(["nobody_here"]);
    expect(calls.bySubject).toEqual([]);
    expect(ctx.memories).toEqual([]);
  });

  test("the same memory from two sources appears once", async () => {
    const shared = makeMemory({ id: "shared" });
    const { recaller } = makeRecaller({ semantic: [shared], bySubject: [shared] });
    const ctx = await buildAgentContext(baseInput(), recaller);

    expect(ctx.memories).toHaveLength(1);
    expect(ctx.memories[0]?.id).toBe("shared");
  });

  test("injected memories are capped", async () => {
    const many = Array.from({ length: 40 }, (_, i) =>
      makeMemory({ id: `mem-${i}`, content: `fact ${i}` }),
    );
    const { recaller } = makeRecaller({ semantic: many });
    const ctx = await buildAgentContext(baseInput(), recaller);

    expect(ctx.memories).toHaveLength(MAX_INJECTED_MEMORIES);
  });

  test("a failing recall degrades to no memories instead of throwing", async () => {
    const spy = spyOn(console, "error").mockImplementation(() => {});
    const { recaller } = makeRecaller({
      semantic: () => Promise.reject(new Error("voyage timeout")),
    });

    const ctx = await buildAgentContext(baseInput({ senderTelegramId: null }), recaller);

    expect(ctx.memories).toEqual([]);
    expect(ctx.system).not.toContain("## Relevant Memories");
    expect(ctx.messages).toHaveLength(1);
    spy.mockRestore();
  });

  test("the GraphQL schema is embedded in the prompt", async () => {
    const { recaller } = makeRecaller();
    const ctx = await buildAgentContext(baseInput(), recaller);

    expect(ctx.system).toContain(SDL);
  });

  test("today's date is taken from the injected clock, in Singapore time", async () => {
    const { recaller } = makeRecaller();
    // NOW is 09:00 UTC → 17:00 on 20 Aug in Asia/Singapore.
    const ctx = await buildAgentContext(baseInput(), recaller);

    expect(ctx.system).toContain("Today's date is 20/08/2026");
  });

  test("late-evening UTC rolls forward to the next Singapore day", async () => {
    const { recaller } = makeRecaller();
    const ctx = await buildAgentContext(
      baseInput({ now: new Date("2026-08-20T17:00:00Z") }),
      recaller,
    );

    expect(ctx.system).toContain("Today's date is 21/08/2026");
  });

  // Readable artifact of exactly what the model receives.
  test("assembled prompt snapshot — group chat with memories", async () => {
    const { recaller } = makeRecaller({
      semantic: [
        makeMemory({
          id: "m1",
          content: "Ashiqurrah is responsible for planning the next meetup",
          subject: "Ashiqurrah",
          category: "event_related",
          confidence: 0.9,
          createdAt: new Date("2026-08-13T00:00:00Z"),
        }),
        makeMemory({
          id: "m2",
          content: "Someone in the chat works at Stripe",
          subject: null,
          category: "general",
          confidence: 0.65,
          createdAt: new Date("2026-04-01T00:00:00Z"),
        }),
      ],
    });

    const ctx = await buildAgentContext(
      baseInput({
        chatHistory: [
          { role: "user", content: "[20 Aug 2026 16:58 @hafiz_dev]\nanyone going this week?" },
        ],
      }),
      recaller,
    );

    expect(ctx.system).toMatchSnapshot();
    expect(ctx.messages).toMatchSnapshot();
  });
});

describe("model identity", () => {
  test("tells the agent which model is actually serving the request", async () => {
    const { recaller } = makeRecaller();
    const ctx = await buildAgentContext(
      baseInput({ runningModel: "deepseek/v4-flash (DeepSeek V4 Flash)" }),
      recaller,
    );

    expect(ctx.system).toContain(
      "You are running on deepseek/v4-flash (DeepSeek V4 Flash)",
    );
  });

  // The observed failure this guards: asked "what model are you?", the agent
  // read the settings table, saw deep → Opus 5, and announced it was Opus 5
  // while actually running on DeepSeek via the fast tier.
  test("warns the agent off inferring its model from the settings table", async () => {
    const { recaller } = makeRecaller();
    const ctx = await buildAgentContext(baseInput(), recaller);

    expect(ctx.system).toContain("not whatever");
    expect(ctx.system).toContain("you always write the final reply");
  });
});

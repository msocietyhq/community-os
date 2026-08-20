import { describe, expect, test } from "bun:test";
import type { ModelMessage } from "ai";
import {
  sanitizeForHandoff,
  buildAdvisorMessages,
  advisorSystemPrompt,
  NEXT_TIER,
} from "./advisor";

const toolCall = (id: string, name: string) =>
  ({ type: "tool-call", toolCallId: id, toolName: name, input: {} }) as never;
const toolResult = (id: string, name: string) =>
  ({ type: "tool-result", toolCallId: id, toolName: name, output: "ok" }) as never;

describe("sanitizeForHandoff", () => {
  test("leaves a plain conversation untouched", () => {
    const messages: ModelMessage[] = [
      { role: "user", content: "hi" },
      { role: "assistant", content: "hello" },
    ];
    expect(sanitizeForHandoff(messages)).toEqual(messages);
  });

  test("keeps tool calls that have a matching result", () => {
    const messages: ModelMessage[] = [
      { role: "user", content: "when is the meetup?" },
      { role: "assistant", content: [toolCall("c1", "graphql_query")] },
      { role: "tool", content: [toolResult("c1", "graphql_query")] },
    ];
    expect(sanitizeForHandoff(messages)).toHaveLength(3);
  });

  /**
   * The advisor's own call is still in flight when it reads the conversation.
   * A dangling tool call is a malformed turn to the next model.
   */
  test("drops the in-flight advisor call that triggered the handoff", () => {
    const messages: ModelMessage[] = [
      { role: "user", content: "hard question" },
      { role: "assistant", content: [toolCall("pending", "big_brain_advisor")] },
    ];
    expect(sanitizeForHandoff(messages)).toHaveLength(1);
    expect(sanitizeForHandoff(messages)[0]?.role).toBe("user");
  });

  test("keeps the text of a turn that also had an unresolved call", () => {
    const messages: ModelMessage[] = [
      { role: "user", content: "hard question" },
      {
        role: "assistant",
        content: [
          { type: "text", text: "Let me think about this." } as never,
          toolCall("pending", "big_brain_advisor"),
        ],
      },
    ];
    const out = sanitizeForHandoff(messages);
    expect(out).toHaveLength(2);
    expect((out[1]?.content as unknown[])).toHaveLength(1);
  });

  test("resolved calls survive alongside an unresolved one", () => {
    const messages: ModelMessage[] = [
      { role: "user", content: "q" },
      { role: "assistant", content: [toolCall("done", "graphql_query")] },
      { role: "tool", content: [toolResult("done", "graphql_query")] },
      { role: "assistant", content: [toolCall("pending", "big_brain_advisor")] },
    ];
    const out = sanitizeForHandoff(messages);
    expect(out).toHaveLength(3);
    expect(out.at(-1)?.role).toBe("tool");
  });

  test("does not mutate the input", () => {
    const messages: ModelMessage[] = [
      { role: "assistant", content: [toolCall("pending", "x")] },
    ];
    sanitizeForHandoff(messages);
    expect(messages).toHaveLength(1);
  });

  test("empty conversation is handled", () => {
    expect(sanitizeForHandoff([])).toEqual([]);
  });
});

describe("buildAdvisorMessages", () => {
  test("appends the problem as the final user turn", () => {
    const out = buildAdvisorMessages([{ role: "user", content: "hi" }], "I'm stuck on X");
    expect(out).toHaveLength(2);
    expect(out.at(-1)?.role).toBe("user");
    expect(out.at(-1)?.content).toContain("I'm stuck on X");
  });

  test("marks the turn as an escalation so the advisor knows its role", () => {
    const out = buildAdvisorMessages([], "problem");
    expect(out[0]?.content).toContain("Escalated by");
  });

  test("sanitises the conversation it carries forward", () => {
    const out = buildAdvisorMessages(
      [
        { role: "user", content: "q" },
        { role: "assistant", content: [toolCall("pending", "big_brain_advisor")] },
      ],
      "stuck",
    );
    // user turn + escalation turn; the dangling call is gone
    expect(out).toHaveLength(2);
  });
});

describe("escalation ladder", () => {
  /** Structural, not prompt-based: bigger_brain has no advisor to call. */
  test("each tier escalates at most one rung, and the top has none", () => {
    expect(NEXT_TIER.main).toBe("big");
    expect(NEXT_TIER.big).toBe("bigger");
    expect(NEXT_TIER.bigger).toBeNull();
  });

  test("the advisor prompt tells it the conversation is real, not a summary", () => {
    const prompt = advisorSystemPrompt("bigger");
    expect(prompt).toContain("actual conversation");
    expect(prompt).toContain("don't re-run a lookup");
  });
});

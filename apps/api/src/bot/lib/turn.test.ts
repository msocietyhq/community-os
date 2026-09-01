import { describe, expect, test } from "bun:test";
import {
  policyFor,
  permittedCallbacks,
  classify,
  deliver,
  type ChatCallbacks,
  type TurnResult,
} from "./turn";

const ADDRESSED = policyFor("addressed");
const UNINVITED = policyFor("uninvited");

const reply = (text: string): TurnResult => ({ kind: "reply", text });
const notice = (text: string): TurnResult => ({ kind: "notice", text });
const silent = (reason: string): TurnResult => ({ kind: "silent", reason });

/** A finished model call, with nothing produced unless a test says otherwise. */
const product = (over: Partial<Parameters<typeof classify>[0]> = {}) => ({
  text: undefined as string | undefined,
  subagentResults: [] as string[],
  silencedReason: null as string | null,
  ...over,
});

describe("policyFor", () => {
  test("an uninvited turn runs on smart and may decline to answer", () => {
    expect(UNINVITED).toEqual({
      kind: "uninvited",
      tier: "smart",
      allowSilence: true,
      deliversNotices: false,
    });
  });

  test("an addressed turn runs on fast and must answer", () => {
    expect(ADDRESSED).toEqual({
      kind: "addressed",
      tier: "fast",
      allowSilence: false,
      deliversNotices: true,
    });
  });
});

describe("permittedCallbacks", () => {
  const all: ChatCallbacks = {
    progressSink: {
      async send() {
        return 1;
      },
      async edit() {},
    },
    askUser: async () => {},
    proposeSettings: async () => {},
  };

  test("an addressed turn keeps every callback", () => {
    expect(permittedCallbacks("addressed", all)).toEqual(all);
  });

  /**
   * The guarantee that matters. Every callback here puts something in the chat,
   * so an uninvited turn holds none of them — ask_user in particular would post
   * a force_reply about a message never addressed to the bot.
   */
  test("an uninvited turn holds no chat-posting callback at all", () => {
    expect(permittedCallbacks("uninvited", all)).toEqual({});
  });

  /**
   * Fail closed. A capability added to ChatCallbacks later is denied to an
   * uninvited turn without anyone remembering to deny it — which is the exact
   * mistake that let ask_user through. Asserted on the key set rather than with
   * toEqual({}), which cannot tell "returns nothing" from "returns every key
   * explicitly undefined".
   */
  test("a newly added callback is denied by default", () => {
    const withNewOne = {
      ...all,
      somethingNew: async () => {},
    } as ChatCallbacks;
    expect(Object.keys(permittedCallbacks("uninvited", withNewOne))).toEqual(
      [],
    );
  });
});

describe("deliver", () => {
  test("an addressed reply is sent and records no chime", () => {
    expect(deliver(reply("here you go"), ADDRESSED)).toEqual({
      send: true,
      text: "here you go",
      recordChime: false,
    });
  });

  test("an uninvited reply is sent and records the chime", () => {
    expect(deliver(reply("@faizal_tan used Budget Mac"), UNINVITED)).toEqual({
      send: true,
      text: "@faizal_tan used Budget Mac",
      recordChime: true,
    });
  });

  test("a notice reaches someone who actually asked", () => {
    const d = deliver(notice("Your profile is not set up yet."), ADDRESSED);
    expect(d.send).toBe(true);
    if (d.send) expect(d.text).toBe("Your profile is not set up yet.");
  });

  /**
   * The four notices that each leaked to a group before this existed. Every one
   * is about the bot's own state, sent to someone who asked the room a question
   * and never asked the bot anything.
   */
  test.each([
    "Your profile is not set up yet. Please use /profile first to set up your community profile!",
    "I'm having trouble authenticating you. Please try again later.",
    "I'm being rate-limited right now. Please try again in a minute or two 🙏",
    "Sorry, I encountered an error. Please try again later.",
  ])("an uninvited turn withholds: %s", (text) => {
    expect(deliver(notice(text), UNINVITED).send).toBe(false);
  });

  test("silence never sends, on either kind of turn", () => {
    expect(deliver(silent("nothing to add"), UNINVITED).send).toBe(false);
    expect(deliver(silent("nothing to add"), ADDRESSED).send).toBe(false);
  });

  /**
   * Staying quiet must not burn the cooldown that gates speaking — only a reply
   * the room actually received counts as having chimed in.
   */
  test("only a delivered reply records a chime", () => {
    const outcomes: TurnResult[] = [
      silent("nothing to add"),
      notice("Sorry, I encountered an error. Please try again later."),
    ];
    for (const outcome of outcomes) {
      const d = deliver(outcome, UNINVITED);
      expect(d.send).toBe(false);
      expect("recordChime" in d).toBe(false);
    }
  });

  test("every refusal explains itself, for the log line", () => {
    for (const d of [
      deliver(silent("no community hit"), UNINVITED),
      deliver(notice("rate limited"), UNINVITED),
    ]) {
      expect(d.send).toBe(false);
      if (!d.send) expect(d.reason.length).toBeGreaterThan(0);
    }
  });
});

describe("classify", () => {
  test("stay_silent wins over anything else the turn produced", () => {
    const result = classify(
      product({
        text: "I was going to say this",
        silencedReason: "nothing to add",
      }),
      UNINVITED,
    );
    expect(result).toEqual({ kind: "silent", reason: "nothing to add" });
  });

  test("the model's own text is a reply, on either kind of turn", () => {
    expect(
      classify(product({ text: "next meetup is Saturday" }), ADDRESSED),
    ).toEqual({
      kind: "reply",
      text: "next meetup is Saturday",
    });
    expect(
      classify(product({ text: "@nurul_h knows Rust" }), UNINVITED),
    ).toEqual({
      kind: "reply",
      text: "@nurul_h knows Rust",
    });
  });

  /**
   * A turn that ends on a tool call leaves no text. When a member asked, the
   * sub-agents' work beats a generic apology.
   */
  test("an addressed turn falls back to sub-agent output", () => {
    expect(
      classify(
        product({ subagentResults: ["Events — 3 found", "Members — 1"] }),
        ADDRESSED,
      ),
    ).toEqual({ kind: "reply", text: "Events — 3 found\n\nMembers — 1" });
  });

  /**
   * The invariant this function exists to make true: an uninvited turn can only
   * produce a deliverable reply from the model's own text. Before it was
   * extracted, this held only because the handler happened to withhold the
   * progress sink, so no sub-agent output was ever collected — safe by wiring
   * rather than by construction, and the next person to pass a sink on a
   * chime-in would have posted a raw transcript into the group.
   */
  test("an uninvited turn never volunteers a sub-agent transcript", () => {
    const result = classify(
      product({ subagentResults: ["Members — searching for battery repair"] }),
      UNINVITED,
    );
    expect(result.kind).toBe("notice");
    expect(deliver(result, UNINVITED).send).toBe(false);
  });

  test("nothing at all is a notice, which an uninvited turn withholds", () => {
    const result = classify(product(), UNINVITED);
    expect(result.kind).toBe("notice");
    expect(deliver(result, UNINVITED).send).toBe(false);
    expect(deliver(classify(product(), ADDRESSED), ADDRESSED).send).toBe(true);
  });
});

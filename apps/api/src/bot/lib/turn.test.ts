import { describe, expect, test } from "bun:test";
import {
  policyFor,
  permittedCallbacks,
  deliver,
  type AgentOutcome,
  type ChatCallbacks,
} from "./turn";

const ADDRESSED = policyFor("addressed");
const UNINVITED = policyFor("uninvited");

const reply = (text: string): AgentOutcome => ({
  kind: "reply",
  text,
  responseMessages: [],
});
const notice = (text: string): AgentOutcome => ({
  kind: "notice",
  text,
  responseMessages: [],
});
const silent = (reason: string): AgentOutcome => ({
  kind: "silent",
  reason,
  responseMessages: [],
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
    progressSink: { async send() { return 1; }, async edit() {} },
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
   * mistake that let ask_user through.
   */
  test("a newly added callback is denied by default", () => {
    const withNewOne = { ...all, somethingNew: async () => {} } as ChatCallbacks;
    expect(permittedCallbacks("uninvited", withNewOne)).toEqual({});
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
   * Staying quiet must not burn the 30-minute cooldown that gates speaking —
   * only a reply the room actually received counts as having chimed in.
   */
  test("only a delivered reply records a chime", () => {
    const outcomes: AgentOutcome[] = [
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

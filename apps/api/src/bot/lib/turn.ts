import type { ModelMessage } from "ai";
import type { ProgressSink } from "./subagent-progress";

/**
 * What a turn is allowed to do, and what actually reaches the chat.
 *
 * This module exists because the alternative didn't work. "Was the bot spoken
 * to?" used to be a boolean consulted at eleven independent sites across the
 * agent and the handler, and every consumer had to remember the rule on its
 * own. Five bugs shipped in two days, each one a missed check at one of those
 * sites: a status message posted to a group that got no reply, a generic
 * "I couldn't generate a response" volunteered to a room, "your profile is not
 * set up yet" answering a question nobody asked the bot, and `ask_user` able to
 * interrupt with a force_reply about a message it was never addressed in.
 *
 * So the rules live here instead, in one table, and the uninvited case fails
 * closed: `permittedCallbacks` grants nothing rather than denying things one at
 * a time. Deliberately free of `env` and database imports, so every decision in
 * it is unit-testable — which the two modules it serves are not.
 */

/** Whether the bot was actually spoken to. */
export type TurnKind = "addressed" | "uninvited";

export interface TurnPolicy {
  kind: TurnKind;
  /**
   * Which tier serves the turn. Deciding whether to speak at all is a harder
   * judgement than answering a question that was actually asked.
   */
  tier: "fast" | "smart";
  /** Whether the agent may decline to reply. */
  allowSilence: boolean;
  /** Whether a message about the bot's own state reaches the chat. */
  deliversNotices: boolean;
}

export function policyFor(kind: TurnKind): TurnPolicy {
  return kind === "uninvited"
    ? { kind, tier: "smart", allowSilence: true, deliversNotices: false }
    : { kind, tier: "fast", allowSilence: false, deliversNotices: true };
}

/**
 * Every callback that lets the agent put something into the chat.
 *
 * Membership of this interface is the definition of "can interrupt the room".
 * Anything added here is denied to an uninvited turn automatically.
 */
export interface ChatCallbacks {
  progressSink?: ProgressSink;
  askUser?: (question: string) => Promise<void>;
  proposeSettings?: (input: {
    changes: { key: string; from: unknown; to: unknown }[];
    rationale?: string;
  }) => Promise<void>;
}

/**
 * The callbacks a turn of this kind may hold.
 *
 * An uninvited turn gets none — not a filtered subset, none. Granting nothing
 * rather than denying case by case is the point: the next capability someone
 * adds is safe before anyone thinks about it.
 *
 * Withholding a callback does not always remove the tool. Only `stay_silent` is
 * conditionally registered; `ask_user` and `propose_settings_change` are always
 * in the tool list and decline at runtime when their callback is absent (see
 * ai/tools.ts). So an uninvited turn can still *call* `ask_user` and burn a step
 * on a refusal — it just cannot make it post anything. The safety is that the
 * callback is the only route to the chat, not that the tool is gone.
 */
export function permittedCallbacks(
  kind: TurnKind,
  all: ChatCallbacks,
): ChatCallbacks {
  return kind === "addressed" ? all : {};
}

/**
 * What a turn produced.
 *
 * The distinction that matters is `reply` versus `notice`. A reply is the
 * model's answer to what was asked. A notice is the bot talking about itself —
 * that it has no profile for you, that it is rate-limited, that it failed. Only
 * the first is worth interrupting a room for, and separating them is what lets
 * one rule ("a notice goes only to someone who asked") replace the checks that
 * used to be scattered through the agent.
 */
export type TurnResult =
  | { kind: "reply"; text: string }
  | { kind: "notice"; text: string }
  | { kind: "silent"; reason: string };

/** A result plus the transcript the session needs to replay the turn. */
export type AgentOutcome = TurnResult & { responseMessages: ModelMessage[] };

/** What a finished model call produced, before it is given a meaning. */
export interface TurnProduct {
  /** The model's own text for the turn. Empty when it ended on a tool call. */
  text: string | undefined;
  /** Output collected from sub-agents, when a progress reporter gathered any. */
  subagentResults: string[];
  /** Set when the agent called stay_silent. */
  silencedReason: string | null;
}

/**
 * What a turn amounts to.
 *
 * Pulled out of runAgent so the one decision that says what a chime-in is
 * allowed to utter can actually be tested — runAgent imports `env` and cannot be
 * imported by a test at all.
 *
 * The rule worth stating: an uninvited turn can only ever produce a deliverable
 * reply from the model's own text. Sub-agent output stands in for an answer when
 * a member asked, because discarding their work behind a generic apology is
 * worse than a rough answer — but a raw transcript of what the bot just did is
 * not something to volunteer to a room. Today that also happens to hold because
 * the handler withholds the progress sink from uninvited turns, so no sub-agent
 * output is ever collected; relying on that is how the next bug gets in.
 */
export function classify(product: TurnProduct, policy: TurnPolicy): TurnResult {
  if (product.silencedReason !== null) {
    return { kind: "silent", reason: product.silencedReason };
  }

  if (product.text) return { kind: "reply", text: product.text };

  if (policy.kind === "addressed" && product.subagentResults.length > 0) {
    return { kind: "reply", text: product.subagentResults.join("\n\n") };
  }

  // Nothing to say. A notice rather than a reply, so `deliver` keeps it out of
  // a room that never asked.
  return {
    kind: "notice",
    text: "I couldn't generate a response. Please try again.",
  };
}

export type Delivery =
  | { send: true; text: string; recordChime: boolean }
  | { send: false; reason: string };

/**
 * The single decision about whether anything reaches the chat.
 *
 * `recordChime` rides along because it has to agree with the send: staying
 * quiet must not burn the cooldown that gates speaking — `chimeIn.cooldownMinutes`
 * from settings, defaulting to CHIME_IN_COOLDOWN_MS. That coupling was previously
 * two statements apart in the handler.
 */
export function deliver(outcome: TurnResult, policy: TurnPolicy): Delivery {
  switch (outcome.kind) {
    case "silent":
      return { send: false, reason: `stayed silent — ${outcome.reason}` };

    case "notice":
      return policy.deliversNotices
        ? { send: true, text: outcome.text, recordChime: false }
        : {
            send: false,
            reason: `notice withheld from an uninvited turn — ${outcome.text}`,
          };

    case "reply":
      return {
        send: true,
        text: outcome.text,
        recordChime: policy.kind === "uninvited",
      };
  }
}

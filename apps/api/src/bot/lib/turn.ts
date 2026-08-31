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
 * An uninvited turn gets none — not a filtered subset, none. Withholding the
 * callback is what removes the corresponding tool, so this is also what keeps
 * `ask_user` and the settings card out of a conversation the bot was not part
 * of. Granting nothing rather than denying case by case is the point: the next
 * capability someone adds is safe before anyone thinks about it.
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
export type AgentOutcome =
  | { kind: "reply"; text: string; responseMessages: ModelMessage[] }
  | { kind: "notice"; text: string; responseMessages: ModelMessage[] }
  | { kind: "silent"; reason: string; responseMessages: ModelMessage[] };

export type Delivery =
  | { send: true; text: string; recordChime: boolean }
  | { send: false; reason: string };

/**
 * The single decision about whether anything reaches the chat.
 *
 * `recordChime` rides along because it has to agree with the send: staying
 * quiet must not burn the 30-minute cooldown that gates speaking, and that
 * coupling was previously two statements apart in the handler.
 */
export function deliver(outcome: AgentOutcome, policy: TurnPolicy): Delivery {
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

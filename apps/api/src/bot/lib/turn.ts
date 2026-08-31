import type { ModelMessage } from "ai";
import type { ProgressSink } from "./subagent-progress";

/**
 * What a turn is allowed to do, and what actually reaches the chat.
 *
 * The bot answers when spoken to, and sometimes volunteers an answer nobody
 * asked for. That second case has to fail closed everywhere, and spreading the
 * check across its consumers didn't hold — each one had to remember it, and
 * several didn't. Every rule lives here now, and an uninvited turn is denied by
 * default rather than denied case by case.
 *
 * Free of `env` and database imports, so all of it is unit-testable — which
 * ai/agent.ts and handlers/ai-chat.ts, which it serves, are not.
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
 * An uninvited turn gets none — not a filtered subset, none, so the next
 * capability added is safe before anyone considers it.
 *
 * What this does and doesn't guarantee: the callback is the only route to the
 * chat, but the tool may still exist. Only `stay_silent` is conditionally
 * registered; `ask_user` and `propose_settings_change` are always in the tool
 * list and decline at runtime when their callback is absent. An uninvited turn
 * can still call them and burn a step on the refusal.
 */
export function permittedCallbacks(
  kind: TurnKind,
  all: ChatCallbacks,
): ChatCallbacks {
  return kind === "addressed" ? all : {};
}

/**
 * What a turn amounted to.
 *
 * A `reply` answers what was asked. A `notice` is the bot talking about itself:
 * no profile for you, rate-limited, failed. Only the first is worth
 * interrupting a room for, and keeping them apart is what reduces the whole
 * uninvited rule to one line in `deliver` — a notice goes only to someone who
 * asked.
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
 * What the turn amounted to. Lives here rather than in runAgent so the decision
 * can be tested; runAgent imports `env` and cannot be imported by a test.
 *
 * The invariant: an uninvited turn only ever produces a deliverable reply from
 * the model's own text. Sub-agent output stands in for an answer when a member
 * asked — their work beats a generic apology — but a raw transcript of what the
 * bot just did is not something to volunteer to a room.
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
 * quiet must not burn the cooldown that gates speaking (`chimeIn.cooldownMinutes`,
 * defaulting to CHIME_IN_COOLDOWN_MS).
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

/**
 * Evaluates the chime-in decision against scripted scenarios.
 *
 * Two suites, run from apps/api so bun loads .env:
 *
 *   bun run scripts/chime-in-eval.ts judge   — the Haiku gate, real judgeChimeIn
 *   bun run scripts/chime-in-eval.ts agent   — the chime-in prompt's own judgement
 *   bun run scripts/chime-in-eval.ts         — both
 *
 * The agent suite is a *prompt* test, not an integration test. It builds the
 * real chime-in system prompt with buildAgentContext and calls the real model,
 * but hands it stub tools returning canned data per scenario. That is what makes
 * "history has a relevant hit" and "history has nothing" reproducible — the two
 * cases that decide whether the grounding rule works.
 *
 * COSTS REAL MONEY and writes ai_usage rows to whatever DATABASE_URL points at
 * (staging, per apps/api/.env). One model call per scenario.
 */
import { stepCountIs, tool } from "ai";
import { z } from "zod";
import { judgeChimeIn } from "../src/bot/lib/chime-in-judge";
import { hasLookedUp, hasAttemptedSilence } from "../src/bot/lib/chime-in";
import { buildAgentContext, type MemoryRecaller } from "../src/bot/ai/context";
import { aiService } from "../src/services/ai.service";

const CHAT_ID = "-1002000000000";

// ─── shared helpers ──────────────────────────────────────────────────────────

const NO_MEMORIES: MemoryRecaller = {
  semantic: async () => [],
  bySubject: async () => [],
  resolveSubject: async () => null,
};

/** The envelope the real handler wraps every message in. */
function msg(from: string, at: string, text: string): string {
  return `<msg from="@${from}" at="${at}">\n${text}\n</msg>`;
}

function pass(ok: boolean): string {
  return ok ? "\x1b[32mPASS\x1b[0m" : "\x1b[31mFAIL\x1b[0m";
}

// ─── suite 1: the judge ──────────────────────────────────────────────────────

interface JudgeCase {
  name: string;
  message: string;
  transcript: string;
  /**
   * What the broad filter should do, or null when the case is genuinely
   * marginal and asserting either way would flake. Measured on the macbook
   * message: the judge returns 0.30-0.75 across runs, wanting to speak roughly
   * 40% of the time at 0.75 — held back only by the 0.8 threshold. Reported
   * rather than asserted, because that 0.05 margin is the finding.
   */
  expectSpeak: boolean | null;
}

const JUDGE_CASES: JudgeCase[] = [
  {
    name: "macbook battery — the original regression",
    message:
      "Anyone did macbook battery change with 3rd party vendor? any trusted one you have tried? (already 4+ years old with my M2, probably changing battery only, condition is still 100%)",
    transcript: msg("someone", "14:02", "morning all"),
    // Marginal by measurement — see expectSpeak. The agent is the real gate.
    expectSpeak: null,
  },
  {
    name: "answerable community question",
    message: "when is the next meetup?",
    transcript: msg("someone", "14:02", "quiet in here"),
    expectSpeak: true,
  },
  {
    name: "banter",
    message: "hahaha that is wild man",
    transcript: msg("other", "14:01", "my build took 40 minutes"),
    expectSpeak: false,
  },
  {
    name: "aimed at a named person",
    message: "@hafiz_dev did you push that fix?",
    transcript: msg("hafiz_dev", "14:00", "on it"),
    expectSpeak: false,
  },
  {
    name: "already answered by a human",
    message: "anyone know a good halal caterer?",
    transcript: [
      msg("a", "14:00", "anyone know a good halal caterer?"),
      msg("b", "14:01", "we used Rasa for the last event, they were great"),
    ].join("\n"),
    expectSpeak: false,
  },
];

async function runJudge(): Promise<void> {
  console.log("\n=== JUDGE (micro tier) ===\n");
  let passed = 0;

  for (const c of JUDGE_CASES) {
    const d = await judgeChimeIn({
      message: c.message,
      transcript: c.transcript,
      chatId: CHAT_ID,
      telegramUserId: null,
    });
    const asserted = c.expectSpeak !== null;
    const ok = d.respond === c.expectSpeak;
    if (asserted && ok) passed++;
    const verdict = asserted ? pass(ok) : "\x1b[33mMARGINAL\x1b[0m";
    console.log(
      `${verdict}  ${c.name}\n` +
        `      → ${d.respond ? "SPEAK" : "quiet"} (${d.confidence.toFixed(2)}) — ${d.reason}\n` +
        `      expected ${asserted ? (c.expectSpeak ? "SPEAK" : "quiet") : "(not asserted — run repeatedly to see the spread)"}\n`,
    );
  }

  const asserted = JUDGE_CASES.filter((c) => c.expectSpeak !== null).length;
  console.log(
    `judge: ${passed}/${asserted} asserted (${JUDGE_CASES.length - asserted} marginal)\n`,
  );
}

// ─── suite 2: the chime-in prompt ────────────────────────────────────────────

interface AgentCase {
  name: string;
  /** What the member posted, unaddressed to the bot. */
  message: string;
  /** Prior messages in the room. */
  history: string[];
  /** Canned chat_history search result. Empty string = nothing found. */
  chatHistoryHit: string;
  /** Canned members lookup. Empty string = nobody matches. */
  membersHit: string;
  /** Canned research result. Empty string = the tool finds nothing usable. */
  researchHit: string;
  expectSilent: boolean;
}

const AGENT_CASES: AgentCase[] = [
  {
    name: "macbook battery, nothing in the community — must stay silent",
    message:
      "Anyone did macbook battery change with 3rd party vendor? any trusted one you have tried?",
    history: [msg("someone", "14:02", "morning all")],
    chatHistoryHit: "",
    membersHit: "",
    researchHit:
      "Various third-party repair shops in Singapore service MacBooks. Quality and warranty implications vary by shop.",
    expectSilent: true,
  },
  {
    name: "macbook battery, a member discussed it before — should speak",
    message:
      "Anyone did macbook battery change with 3rd party vendor? any trusted one you have tried?",
    history: [msg("someone", "14:02", "morning all")],
    chatHistoryHit:
      '[msg 8812, 12 Mar 2026] <msg from="@faizal_tan">got my M1 battery swapped at Budget Mac in Sim Lim, 180 dollars, took 2 hours, no issues since</msg>',
    membersHit: "",
    researchHit: "",
    expectSilent: false,
  },
  {
    name: "generic tech question — must stay silent",
    message: "what is the actual difference between docker and podman?",
    history: [msg("someone", "14:02", "containers again")],
    chatHistoryHit: "",
    membersHit: "",
    researchHit:
      "Podman is daemonless and rootless by default; Docker uses a central daemon.",
    expectSilent: true,
  },
  {
    name: "asking who knows a topic, a member's profile matches — should speak",
    message: "anyone here done much with rust in production?",
    history: [msg("someone", "14:02", "thinking about rewriting our parser")],
    chatHistoryHit: "",
    membersHit:
      "@nurul_h — skills: Rust, systems programming. Project: 'ledger-core' (Rust). Joined 2019.",
    researchHit: "",
    expectSilent: false,
  },
  {
    name: "advice-shaped question with nothing specific — must stay silent",
    message: "is it worth switching to a standing desk? anyone regret it?",
    history: [msg("someone", "14:02", "my back is killing me")],
    chatHistoryHit: "",
    membersHit: "",
    researchHit:
      "Studies on standing desks show mixed results for back pain; ergonomics guidance suggests alternating positions.",
    expectSilent: true,
  },
];

/**
 * Stub tools mirroring the names and shapes the chime-in prompt names.
 *
 * Canned rather than real so each scenario pins exactly what the community
 * does and doesn't know — the variable the grounding rule turns on.
 */
function stubTools(c: AgentCase, onSilence: (reason: string) => void) {
  const empty = (what: string) => `No results for that ${what}.`;

  return {
    chat_history: tool({
      description:
        "Read past messages from the current chat. Pass `query` for semantic/keyword search.",
      inputSchema: z.object({
        query: z.string().optional(),
        message_ids: z.array(z.number()).optional(),
        limit: z.number().optional(),
      }),
      execute: async () => c.chatHistoryHit || empty("search"),
    }),
    members: tool({
      description:
        "Find or manage community members: search by skills/interests, view profiles, check reputation.",
      inputSchema: z.object({ query: z.string() }),
      execute: async () => c.membersHit || empty("member lookup"),
    }),
    graphql_query: tool({
      description:
        "Query community data via GraphQL. Types: events, projects, venues, members.",
      inputSchema: z.object({
        query: z.string(),
        variables: z.record(z.string(), z.unknown()).optional(),
      }),
      execute: async () => empty("query"),
    }),
    research: tool({
      description: "Search the live web and read pages.",
      inputSchema: z.object({ query: z.string() }),
      execute: async () => c.researchHit || empty("web search"),
    }),
    stay_silent: tool({
      description:
        "Say nothing at all, and end the turn. Use this when you have nothing specific to contribute — no message from this chat, no member, no event or project, no fact you can cite — or when what you would otherwise write is advice, considerations, or suggestions rather than a specific. Staying silent is a correct outcome, not a failure.",
      inputSchema: z.object({ reason: z.string() }),
      execute: async ({ reason }, { messages }) => {
        // Mirrors the real tool: abstaining is refused until something has
        // actually been searched.
        if (!hasLookedUp(messages) && !hasAttemptedSilence(messages)) {
          return {
            silent: false,
            note: "You haven't looked yet. Search chat_history for this topic — and members, if the question is about who would know — then decide.",
          };
        }
        onSilence(reason);
        return {
          silent: true,
          note: "Nothing will be sent. End your turn now with no further text.",
        };
      },
    }),
  };
}

async function runAgent(): Promise<void> {
  console.log("\n=== CHIME-IN PROMPT (smart tier) ===\n");
  let passed = 0;

  for (const c of AGENT_CASES) {
    let silenced: string | null = null;

    const { system, messages } = await buildAgentContext(
      {
        query: c.message,
        enrichedQuery: msg("asker", "14:05", c.message),
        chatHistory: c.history.map((content) => ({
          role: "user" as const,
          content,
        })),
        senderTelegramId: null,
        schemaSDL: "",
        runningModel: "anthropic/sonnet-5 (Sonnet 5)",
        now: new Date(),
        chatId: CHAT_ID,
        chimingIn: true,
      },
      NO_MEMORIES,
    );

    const result = await aiService.generateText(
      {
        system,
        messages,
        tools: stubTools(c, (r) => {
          silenced = r;
        }),
        stopWhen: stepCountIs(10),
        maxOutputTokens: 1024,
      },
      {
        caller: "chime-in-eval",
        tier: "smart",
        telegramUserId: null,
        chatId: CHAT_ID,
      },
    );

    const wasSilent = silenced !== null;
    const ok = wasSilent === c.expectSilent;
    if (ok) passed++;

    const toolsUsed = result.steps
      .flatMap((s) => s.toolCalls.map((t) => t.toolName))
      .join(", ");

    console.log(
      `${pass(ok)}  ${c.name}\n` +
        `      tools: ${toolsUsed || "(none)"}\n` +
        `      → ${wasSilent ? `SILENT — ${silenced}` : `SPOKE — ${result.text.replace(/\n/g, " ")}`}\n` +
        `      expected ${c.expectSilent ? "SILENT" : "SPOKE"}\n`,
    );
  }

  console.log(`agent: ${passed}/${AGENT_CASES.length}\n`);
}

// ─── entry ───────────────────────────────────────────────────────────────────

const suite = process.argv[2];

if (suite !== "agent") await runJudge();
if (suite !== "judge") await runAgent();

process.exit(0);

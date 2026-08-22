import { describe, expect, test } from "bun:test";
import {
  renderProgress,
  SubagentProgress,
  type Scheduler,
  trackToolCalls,
  SUBAGENT_TOOLS,
  toolLabel,
  describeToolCall,
  graphqlRootField,
  MIN_EDIT_INTERVAL_MS,
  MAX_MESSAGE_CHARS,
  type ProgressSink,
  type SubagentBatch,
} from "./subagent-progress";

/** Progress renders to entities now; these assertions read the plain text. */
const render = (batches: SubagentBatch[]) => renderProgress(batches).text;

/** Captures every send/edit so the message's whole lifecycle can be asserted. */
function makeSink(options: { failSend?: boolean } = {}) {
  const sent: string[] = [];
  const edits: { messageId: number; text: string }[] = [];

  const sink: ProgressSink = {
    async send(message) {
      sent.push(message.text);
      return options.failSend ? null : 100;
    },
    async edit(messageId, message) {
      edits.push({ messageId, text: message.text });
    },
  };

  return {
    sink,
    sent,
    edits,
    /** Whatever the message currently reads, or null if never posted. */
    current: () => edits.at(-1)?.text ?? sent.at(-1) ?? null,
  };
}

/** Scheduler whose timers only fire when the test says so. */
function makeScheduler() {
  let pending: (() => void)[] = [];
  const scheduler: Scheduler = {
    schedule(fn) {
      pending.push(fn);
      return () => {
        pending = pending.filter((p) => p !== fn);
      };
    },
  };
  return {
    scheduler,
    fire: () => {
      const due = pending;
      pending = [];
      for (const fn of due) fn();
    },
    pendingCount: () => pending.length,
  };
}

/** Lets queued microtask renders settle. */
const settle = () => new Promise<void>((r) => setTimeout(r, 0));

// ─── renderProgress ──────────────────────────────────────────────────────────

describe("renderProgress", () => {
  test("running batch lists each sub-agent with its query", () => {
    const batches: SubagentBatch[] = [
      [
        { name: "Events", query: "upcoming meetups", state: "running", activeTools: [], toolLog: [], children: [] },
        { name: "Projects", query: "active projects", state: "running", activeTools: [], toolLog: [], children: [] },
      ],
    ];
    expect(render(batches)).toBe(
      "Running 2 subagents\n" +
        "⏳ Events — upcoming meetups\n" +
        "⏳ Projects — active projects",
    );
  });

  test("a settled sub-agent keeps its task line and gains a checkmark", () => {
    const batches: SubagentBatch[] = [
      [{ name: "Events", query: "upcoming meetups", state: "done", detail: "3 meetups", activeTools: [], toolLog: [], children: [] }],
    ];
    expect(render(batches)).toBe(
      "Done — 1 subagent\n✅ Events — upcoming meetups",
    );
  });

  test("the sub-agent's own answer is not shown", () => {
    const batches: SubagentBatch[] = [
      [{ name: "Events", query: "upcoming meetups", state: "done", detail: "3 meetups on 24 Aug", activeTools: [], toolLog: [], children: [] }],
    ];
    expect(render(batches)).not.toContain("24 Aug");
  });

  test("a batch is still running while any member is", () => {
    const batches: SubagentBatch[] = [
      [
        { name: "Events", query: "meetups", state: "done", detail: "3 meetups", activeTools: [], toolLog: [], children: [] },
        { name: "Projects", query: "projects", state: "running", activeTools: [], toolLog: [], children: [] },
      ],
    ];
    expect(render(batches)).toContain("Running 2 subagents");
  });

  test("failures keep their reason, since the reply cannot explain the gap", () => {
    const batches: SubagentBatch[] = [
      [{ name: "GitHub", query: "list repos", state: "failed", detail: "rate limited", activeTools: [], toolLog: [], children: [] }],
    ];
    expect(render(batches)).toBe(
      "Done — 1 subagent\n❌ GitHub — list repos (failed: rate limited)",
    );
  });

  test("later rounds are appended below finished ones", () => {
    const batches: SubagentBatch[] = [
      [{ name: "Events", query: "meetups", state: "done", detail: "3 meetups", activeTools: [], toolLog: [], children: [] }],
      [{ name: "Members", query: "who is going", state: "running", activeTools: [], toolLog: [], children: [] }],
    ];
    expect(render(batches)).toBe(
      "Done — 1 subagent\n" +
        "✅ Events — meetups\n" +
        "\n" +
        "Running 1 subagent\n" +
        "⏳ Members — who is going",
    );
  });

  test("multi-line tasks are flattened to one line", () => {
    const batches: SubagentBatch[] = [
      [{ name: "Events", query: "line one\n\nline two", state: "running", activeTools: [], toolLog: [], children: [] }],
    ];
    expect(render(batches)).toContain("⏳ Events — line one line two");
  });

  test("long tasks are truncated", () => {
    const batches: SubagentBatch[] = [
      [{ name: "Events", query: "A".repeat(400), state: "running", activeTools: [], toolLog: [], children: [] }],
    ];
    const line = render(batches).split("\n")[1] ?? "";
    expect(line).toContain("…");
    expect(line.length).toBeLessThan(100);
  });

  // Styling is carried by entities now, so the text is never rewritten —
  // markup a member or model typed stays exactly as typed.
  test("markup in a running query is left verbatim", () => {
    const out = render([
      [{ name: "Events", query: "<b>hi</b> & bye", state: "running", activeTools: [], toolLog: [], children: [] }],
    ]);
    expect(out).toContain("<b>hi</b> & bye");
    expect(out).not.toContain("&amp;");
  });

  test("markup in a failure reason is left verbatim", () => {
    const out = render([
      [{ name: "Events", query: "q", state: "failed", detail: "a & b <script>", activeTools: [], toolLog: [], children: [] }],
    ]);
    expect(out).toContain("a & b <script>");
    expect(out).not.toContain("&lt;");
  });

  test("the sub-agent name is bold, as an entity rather than markup", () => {
    const [batch] = [
      [{ name: "Events", query: "q", state: "running" as const, activeTools: [], toolLog: [], children: [] }],
    ];
    const rendered = renderProgress(batch ? [batch] : []);
    const bold = (rendered.entities ?? [])
      .filter((e) => e.type === "bold")
      .map((e) => rendered.text.slice(e.offset, e.offset + e.length));
    expect(bold).toContain("Events");
  });

  test("empty batches render nothing", () => {
    expect(render([])).toBe("");
    expect(render([[]])).toBe("");
  });
});

// ─── SubagentProgress ────────────────────────────────────────────────────────

describe("SubagentProgress", () => {
  function setup(failSend = false) {
    const sink = makeSink({ failSend });
    const clock = makeScheduler();
    const progress = new SubagentProgress({
      sink: sink.sink,
      scheduler: clock.scheduler,
      minEditIntervalMs: 0,
    });
    return { ...sink, ...clock, progress };
  }

  test("a fast sub-agent never posts a message", async () => {
    const { progress, sent, edits } = setup();

    const handle = progress.start("Events", "upcoming meetups");
    handle.done("3 meetups");
    await progress.finish();

    expect(sent).toEqual([]);
    expect(edits).toEqual([]);
  });

  test("a slow sub-agent posts once the reveal timer fires", async () => {
    const { progress, sent, fire } = setup();

    progress.start("Events", "upcoming meetups");
    expect(sent).toEqual([]);

    fire();
    await settle();

    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain("Running 1 subagent");
    expect(sent[0]).toContain("⏳ Events — upcoming meetups");
  });

  test("sub-agents started together share one round", async () => {
    const { progress, sent, fire } = setup();

    progress.start("Events", "meetups");
    progress.start("Projects", "projects");
    fire();
    await settle();

    expect(sent[0]).toContain("Running 2 subagents");
  });

  test("the message is edited as each sub-agent settles", async () => {
    const { progress, current, fire, edits } = setup();

    const events = progress.start("Events", "meetups");
    const projects = progress.start("Projects", "projects");
    fire();
    await settle();

    events.done("3 meetups");
    await settle();
    expect(current()).toContain("✅ Events — meetups");
    expect(current()).toContain("Running 2 subagents");

    projects.done("12 projects");
    await settle();
    expect(current()).toContain("Done — 2 subagents");
    expect(current()).toContain("✅ Projects — projects");
    expect(edits.every((e) => e.messageId === 100)).toBe(true);
  });

  /** The behaviour requested: keep the finished round, append the next one. */
  test("a later round is appended, keeping the earlier round's end state", async () => {
    const { progress, current, fire } = setup();

    const first = progress.start("Events", "meetups");
    fire();
    await settle();
    first.done("3 meetups");
    await settle();

    const second = progress.start("Members", "who is going");
    await settle();
    second.done("8 members going");
    await progress.finish();

    const text = current() ?? "";
    expect(text).toBe(
      "Done — 1 subagent\n" +
        "✅ Events — meetups\n" +
        "\n" +
        "Done — 1 subagent\n" +
        "✅ Members — who is going",
    );
  });

  test("a sub-agent joining a running round is added to it", async () => {
    const { progress, current, fire } = setup();

    progress.start("Events", "meetups");
    fire();
    await settle();

    progress.start("Projects", "projects");
    await settle();

    expect(current()).toContain("Running 2 subagents");
  });

  test("an earlier fast round still appears once a later round reveals", async () => {
    const { progress, current, fire, sent } = setup();

    const fast = progress.start("Events", "meetups");
    fast.done("3 meetups");
    expect(sent).toEqual([]);

    progress.start("GitHub", "list repos");
    fire();
    await settle();

    const text = current() ?? "";
    expect(text).toContain("✅ Events — meetups");
    expect(text).toContain("Running 1 subagent");
  });

  test("failures show in the final state", async () => {
    const { progress, current, fire } = setup();

    const handle = progress.start("GitHub", "list repos");
    fire();
    await settle();
    handle.failed("rate limited");
    await progress.finish();

    expect(current()).toContain("❌ GitHub — list repos (failed: rate limited)");
  });

  test("settling twice is ignored", async () => {
    const { progress, current, fire } = setup();

    const handle = progress.start("Events", "meetups");
    fire();
    await settle();
    handle.done("3 meetups");
    await settle();
    handle.failed("should not overwrite");
    await settle();

    expect(current()).toContain("✅ Events — meetups");
    expect(current()).not.toContain("failed");
  });

  test("identical renders do not produce redundant edits", async () => {
    const { progress, edits, fire } = setup();

    const handle = progress.start("Events", "meetups");
    fire();
    await settle();

    handle.done("3 meetups");
    await settle();
    const afterFirst = edits.length;

    await progress.finish();
    expect(edits.length).toBe(afterFirst);
  });

  test("finish is silent when nothing ever revealed", async () => {
    const { progress, sent, edits } = setup();
    await progress.finish();
    expect(sent).toEqual([]);
    expect(edits).toEqual([]);
  });

  test("finish cancels a pending reveal", async () => {
    const { progress, pendingCount, sent } = setup();

    const handle = progress.start("Events", "meetups");
    handle.done("3 meetups");
    expect(pendingCount()).toBe(1);

    await progress.finish();
    expect(pendingCount()).toBe(0);
    expect(sent).toEqual([]);
  });

  test("a failed send is not retried on every update", async () => {
    const { progress, sent, edits, fire } = setup(true);

    const handle = progress.start("Events", "meetups");
    fire();
    await settle();
    expect(sent).toHaveLength(1);

    handle.done("3 meetups");
    await progress.finish();

    expect(edits).toEqual([]);
    expect(sent).toHaveLength(1);
  });

  test("completedResults returns only successful output", async () => {
    const { progress, fire } = setup();

    const ok = progress.start("Events", "meetups");
    const bad = progress.start("GitHub", "repos");
    fire();
    await settle();

    ok.done("3 meetups");
    bad.failed("rate limited");
    await progress.finish();

    expect(progress.completedResults()).toEqual(["3 meetups"]);
  });

  // ── nested tool calls ─────────────────────────────────────────────────────

  test("a running sub-agent shows the tool it is calling", async () => {
    const { progress, current, fire } = setup();

    const handle = progress.start("Events", "meetups");
    fire();
    await settle();

    handle.activity.toolStart("graphql_query");
    await settle();

    expect(current()).toContain("⏳ Events — meetups\n    ↳ looking up data");
  });

  test("the last tool stays on screen after it finishes", async () => {
    const { progress, current, fire } = setup();

    const handle = progress.start("Events", "meetups");
    fire();
    await settle();

    const end = handle.activity.toolStart("graphql_query");
    await settle();
    end();
    await settle();

    // Deliberate: tool calls are far shorter than the sub-agents running them.
    expect(current()).toContain("↳ looking up data");
    expect(current()).toContain("⏳ Events — meetups");
  });

  test("parallel tool calls are listed together", async () => {
    const { progress, current, fire } = setup();

    const handle = progress.start("Events", "meetups");
    fire();
    await settle();

    handle.activity.toolStart("graphql_query");
    handle.activity.toolStart("rsvp_event");
    await settle();

    expect(current()).toContain("↳ looking up data\n    ↳ RSVPing");
  });

  test("ending one of two parallel tools leaves the other", async () => {
    const { progress, current, fire } = setup();

    const handle = progress.start("Events", "meetups");
    fire();
    await settle();

    const endFirst = handle.activity.toolStart("graphql_query");
    handle.activity.toolStart("rsvp_event");
    await settle();
    endFirst();
    await settle();

    // Both stay: the stack is a history, not a live view.
    expect(current()).toContain("↳ looking up data");
    expect(current()).toContain("↳ RSVPing");
  });

  test("consecutive calls to the same tool collapse into a count", async () => {
    const { progress, current, fire } = setup();

    const handle = progress.start("Events", "meetups");
    fire();
    await settle();

    const endA = handle.activity.toolStart("graphql_query");
    handle.activity.toolStart("graphql_query");
    await settle();
    endA();
    await settle();

    expect(current()).toContain("↳ looking up data ×2");
  });

  test("the stack grows in call order", async () => {
    const { progress, current, fire } = setup();

    const handle = progress.start("Events", "plan it");
    fire();
    await settle();
    handle.activity.toolStart("graphql_query")();
    handle.activity.toolStart("create_event")();
    handle.activity.toolStart("rsvp_event");
    await settle();

    const lines = (current() ?? "").split("\n").filter((l) => l.includes("↳"));
    expect(lines).toEqual([
      "    ↳ looking up data",
      "    ↳ creating the event",
      "    ↳ RSVPing",
    ]);
  });

  test("a long stack folds the oldest entries away", async () => {
    const { progress, current, fire } = setup();

    const handle = progress.start("Events", "plan it");
    fire();
    await settle();
    for (const t of [
      "graphql_query", "create_event", "update_event",
      "delete_event", "rsvp_event", "get_reputation", "get_leaderboard",
    ]) {
      handle.activity.toolStart(t)();
    }
    await settle();

    const text = current() ?? "";
    expect(text).toContain("↳ …2 earlier");
    expect(text).toContain("↳ reading the leaderboard");
    expect(text).not.toContain("looking up data");
  });

  test("the stack collapses away when the sub-agent settles", async () => {
    const { progress, current, fire } = setup();

    const handle = progress.start("Events", "plan it");
    fire();
    await settle();
    handle.activity.toolStart("graphql_query")();
    handle.activity.toolStart("create_event")();
    await settle();
    expect((current() ?? "").split("\n").filter((l) => l.includes("↳"))).toHaveLength(2);

    handle.done("event created");
    await progress.finish();

    expect(current()).toBe(
      "Done — 1 subagent\n✅ Events — plan it",
    );
  });

  test("a settled sub-agent shows no tool line", async () => {
    const { progress, current, fire } = setup();

    const handle = progress.start("Events", "meetups");
    fire();
    await settle();
    handle.activity.toolStart("graphql_query");
    await settle();

    handle.done("3 meetups");
    await progress.finish();

    expect(current()).toContain("✅ Events — meetups");
    expect(current()).not.toContain("↳");
  });

  test("ending a tool twice is harmless", async () => {
    const { progress, current, fire } = setup();

    const handle = progress.start("Events", "meetups");
    fire();
    await settle();

    const end = handle.activity.toolStart("graphql_query");
    handle.activity.toolStart("rsvp_event");
    await settle();
    end();
    end();
    await settle();

    expect(current()).toContain("↳ RSVPing");
  });

  test("tool names go out verbatim, with no markup to neutralise", async () => {
    const { progress, current, fire } = setup();

    const handle = progress.start("Events", "meetups");
    fire();
    await settle();
    handle.activity.toolStart("<script>");
    await settle();

    // Nothing is escaped because nothing is parsed — the text is sent as-is and
    // the styling travels as entities, so markup here is inert either way.
    expect(current()).toContain("<script>");
    expect(current()).not.toContain("&lt;");
  });

  test("started reflects whether any sub-agent ran", () => {
    const { progress } = setup();
    expect(progress.started).toBe(false);
    progress.start("Events", "meetups");
    expect(progress.started).toBe(true);
  });
});

// ─── nesting ─────────────────────────────────────────────────────────────────

describe("nested sub-agents", () => {
  function setup() {
    const sink = makeSink();
    const clock = makeScheduler();
    const progress = new SubagentProgress({
      sink: sink.sink,
      scheduler: clock.scheduler,
      minEditIntervalMs: 0,
    });
    return { ...sink, ...clock, progress };
  }

  test("a sub-agent's children are indented beneath it", async () => {
    const { progress, current, fire } = setup();

    const parent = progress.start("Events", "plan the meetup");
    fire();
    await settle();

    parent.activity.start("Venues", "find a room");
    await settle();

    expect(current()).toBe(
      "Running 1 subagent\n" +
        "⏳ Events — plan the meetup\n" +
        "    ⏳ Venues — find a room",
    );
  });

  test("nesting is not limited to one level", async () => {
    const { progress, current, fire } = setup();

    const a = progress.start("Events", "plan the meetup");
    fire();
    await settle();
    const b = a.activity.start("Venues", "find a room");
    const c = b.activity.start("Members", "who can host");
    c.activity.start("GitHub", "check the rota repo");
    await settle();

    const lines = (current() ?? "").split("\n");
    expect(lines[1]).toBe("⏳ Events — plan the meetup");
    expect(lines[2]).toBe("    ⏳ Venues — find a room");
    expect(lines[3]).toBe("        ⏳ Members — who can host");
    expect(lines[4]).toBe("            ⏳ GitHub — check the rota repo");
  });

  test("a child's tools indent under the child", async () => {
    const { progress, current, fire } = setup();

    const parent = progress.start("Events", "plan the meetup");
    fire();
    await settle();
    const child = parent.activity.start("Venues", "find a room");
    child.activity.toolStart("graphql_query");
    await settle();

    expect(current()).toContain("    ⏳ Venues — find a room\n        ↳ looking up data");
  });

  test("children settle independently of their parent", async () => {
    const { progress, current, fire } = setup();

    const parent = progress.start("Events", "plan the meetup");
    fire();
    await settle();
    const child = parent.activity.start("Venues", "find a room");
    await settle();

    child.done("Room 3 is free");
    await settle();

    expect(current()).toContain("⏳ Events — plan the meetup");
    expect(current()).toContain("    ✅ Venues — find a room");
    expect(current()).toContain("Running 1 subagent");
  });

  test("a settled parent keeps showing its children", async () => {
    const { progress, current, fire } = setup();

    const parent = progress.start("Events", "plan the meetup");
    fire();
    await settle();
    const child = parent.activity.start("Venues", "find a room");
    child.done("Room 3 is free");
    parent.done("Meetup planned");
    await progress.finish();

    expect(current()).toBe(
      "Done — 1 subagent\n" +
        "✅ Events — plan the meetup\n" +
        "    ✅ Venues — find a room",
    );
  });

  test("the top-level round count ignores nested sub-agents", async () => {
    const { progress, current, fire } = setup();

    const parent = progress.start("Events", "plan the meetup");
    fire();
    await settle();
    parent.activity.start("Venues", "find a room");
    parent.activity.start("Members", "who can host");
    await settle();

    expect(current()).toContain("Running 1 subagent");
  });

  test("completedResults collects successes from every depth", async () => {
    const { progress, fire } = setup();

    const parent = progress.start("Events", "plan the meetup");
    fire();
    await settle();
    const child = parent.activity.start("Venues", "find a room");
    const failing = parent.activity.start("GitHub", "check repo");

    child.done("Room 3 is free");
    failing.failed("rate limited");
    parent.done("Meetup planned");
    await progress.finish();

    expect(progress.completedResults()).toEqual(["Meetup planned", "Room 3 is free"]);
  });

  test("a deep tree is clamped to Telegram's message limit", () => {
    const { progress } = setup();
    let handle = progress.start("Root", "x".repeat(50));
    for (let i = 0; i < 200; i++) {
      handle = handle.activity.start(`Agent${i}`, "y".repeat(50));
    }
    // Rendered via the same path the sink would receive.
    const text = render([[]]);
    expect(text.length).toBeLessThanOrEqual(MAX_MESSAGE_CHARS + 2);
  });
});

// ─── edit throttling ─────────────────────────────────────────────────────────

describe("edit throttling", () => {
  function setup() {
    const sink = makeSink();
    const clock = makeScheduler();
    let time = 0;
    const progress = new SubagentProgress({
      sink: sink.sink,
      scheduler: clock.scheduler,
      now: () => time,
    });
    return { ...sink, ...clock, progress, advance: (ms: number) => { time += ms; } };
  }

  test("the first post is never delayed", async () => {
    const { progress, sent, fire } = setup();
    progress.start("Events", "meetups");
    fire();
    await settle();
    expect(sent).toHaveLength(1);
  });

  test("edits inside the interval are deferred, not dropped", async () => {
    const { progress, edits, fire, advance, current } = setup();

    const handle = progress.start("Events", "meetups");
    fire();
    await settle();

    // Two updates in quick succession, well inside the window.
    handle.activity.toolStart("graphql_query");
    await settle();
    expect(edits).toHaveLength(0);

    // The deferred render fires once the window has passed.
    advance(MIN_EDIT_INTERVAL_MS);
    fire();
    await settle();

    expect(edits).toHaveLength(1);
    expect(current()).toContain("looking up data");
  });

  test("only the latest state is sent when several updates are coalesced", async () => {
    const { progress, edits, fire, advance, current } = setup();

    const handle = progress.start("Events", "meetups");
    fire();
    await settle();

    const end = handle.activity.toolStart("graphql_query");
    await settle();
    end();
    handle.activity.toolStart("rsvp_event");
    await settle();

    advance(MIN_EDIT_INTERVAL_MS);
    fire();
    await settle();

    // One edit for two updates, carrying the state as of the flush.
    expect(edits).toHaveLength(1);
    expect(current()).toContain("looking up data");
    expect(current()).toContain("RSVPing");
  });

  test("an edit past the interval goes straight out", async () => {
    const { progress, edits, fire, advance } = setup();

    const handle = progress.start("Events", "meetups");
    fire();
    await settle();

    advance(MIN_EDIT_INTERVAL_MS + 1);
    handle.activity.toolStart("graphql_query");
    await settle();

    expect(edits).toHaveLength(1);
  });

  test("finish bypasses the throttle so the end state lands immediately", async () => {
    const { progress, current, fire } = setup();

    const handle = progress.start("Events", "meetups");
    fire();
    await settle();

    handle.done("3 meetups");
    await progress.finish();

    expect(current()).toContain("✅ Events — meetups");
  });
});

// ─── regression: tool visibility under real timings ──────────────────────────

describe("tool line visibility", () => {
  /**
   * Sub-agents run 3.5–8.7s in production, but each tool call inside them
   * lasts a few hundred ms. Rendering the tool only while it is in flight
   * meant the line was almost never on screen when an edit actually landed.
   */
  test("a short tool call stays visible after it finishes", async () => {
    const sink = makeSink();
    const clock = makeScheduler();
    let time = 0;
    const progress = new SubagentProgress({
      sink: sink.sink,
      scheduler: clock.scheduler,
      now: () => time,
      revealDelayMs: 1500,
    });
    const advance = (ms: number) => { time += ms; };
    const seen: string[] = [];
    const record = () => { const t = sink.current(); if (t) seen.push(t); };

    // Step 1 returns a tool call at ~1.0s — before the 1.5s reveal — and the
    // query is fast, so the tool is long finished by the time anything is
    // posted. This is the common shape: one tool call, early, short.
    const handle = progress.start("Members", "find typescript people");
    advance(1000);
    const end = handle.activity.toolStart("graphql_query");
    await settle();
    advance(200);
    end();
    await settle();

    // Reveal fires; the message is posted for the first time.
    advance(300);
    clock.fire();
    await settle();
    record();

    // Step 2 thinks for another 3s, then the sub-agent finishes.
    advance(3000);
    clock.fire();
    await settle();
    record();

    handle.done("found 4 members");
    await progress.finish();
    record();

    const everShown = seen.some((t) => t.includes("looking up data"));
    expect(everShown).toBe(true);
  });

  test("the tool line clears once the sub-agent settles", async () => {
    const sink = makeSink();
    const clock = makeScheduler();
    const progress = new SubagentProgress({
      sink: sink.sink,
      scheduler: clock.scheduler,
      minEditIntervalMs: 0,
    });

    const handle = progress.start("Members", "find typescript people");
    clock.fire();
    await settle();
    handle.activity.toolStart("graphql_query")();
    await settle();
    handle.done("found 4 members");
    await progress.finish();

    expect(sink.current()).not.toContain("↳");
  });

  test("a newer tool stacks under the previous one", async () => {
    const sink = makeSink();
    const clock = makeScheduler();
    const progress = new SubagentProgress({
      sink: sink.sink,
      scheduler: clock.scheduler,
      minEditIntervalMs: 0,
    });

    const handle = progress.start("Events", "plan it");
    clock.fire();
    await settle();
    handle.activity.toolStart("graphql_query")();
    await settle();
    handle.activity.toolStart("rsvp_event");
    await settle();

    expect(sink.current()).toContain("looking up data");
    expect(sink.current()).toContain("RSVPing");
  });
});

// ─── toolLabel ───────────────────────────────────────────────────────────────

describe("toolLabel", () => {
  test("known tools get a friendly label", () => {
    expect(toolLabel("graphql_query")).toBe("looking up data");
    expect(toolLabel("list_github_prs")).toBe("reading pull requests");
  });

  test("unknown tools fall back to a readable form of their name", () => {
    expect(toolLabel("some_new_tool")).toBe("some new tool");
  });
});

// ─── trackToolCalls ──────────────────────────────────────────────────────────

describe("trackToolCalls", () => {
  const makeActivity = () => {
    const events: string[] = [];
    return {
      events,
      activity: {
        toolStart(name: string) {
          events.push(`start:${name}`);
          return () => {
            events.push(`end:${name}`);
          };
        },
        start: () => {
          throw new Error("not used in these tests");
        },
      },
    };
  };

  test("returns the toolset untouched when there is nothing to report to", () => {
    const tools = { a: { execute: async () => "x" } } as never;
    expect(trackToolCalls(tools, undefined)).toBe(tools);
  });

  test("reports start and end around a tool call", async () => {
    const { events, activity } = makeActivity();
    const tools = trackToolCalls(
      { graphql_query: { execute: async () => "rows" } } as never,
      activity,
    ) as unknown as Record<string, { execute: (a: unknown, o: unknown) => Promise<string> }>;

    const out = await tools.graphql_query!.execute({}, {});

    expect(out).toBe("rows");
    expect(events).toEqual(["start:graphql_query", "end:graphql_query"]);
  });

  test("reports the end even when the tool throws", async () => {
    const { events, activity } = makeActivity();
    const tools = trackToolCalls(
      { rsvp_event: { execute: async () => { throw new Error("boom"); } } } as never,
      activity,
    ) as unknown as Record<string, { execute: (a: unknown, o: unknown) => Promise<string> }>;

    await expect(tools.rsvp_event!.execute({}, {})).rejects.toThrow("boom");
    expect(events).toEqual(["start:rsvp_event", "end:rsvp_event"]);
  });

  test("tools without an execute are passed through", () => {
    const { activity } = makeActivity();
    const tools = trackToolCalls({ client_side: { description: "x" } } as never, activity);
    expect(tools).toHaveProperty("client_side");
  });
});

// ─── describing tool calls ───────────────────────────────────────────────────

describe("graphqlRootField", () => {
  test.each([
    ["{ events { id } }", "events"],
    ["query { members { items { id } } }", "members"],
    ["query Upcoming { events(limit: 5) { id } }", "events"],
    ["\n  query  {\n    venues {\n      id\n    }\n  }", "venues"],
    ["mutation { createEvent(title: \"x\") { id } }", "createEvent"],
  ])("%s → %s", (query, expected) => {
    expect(graphqlRootField(query)).toBe(expected);
  });

  test("returns undefined for anything unparseable", () => {
    expect(graphqlRootField("not a query")).toBeUndefined();
    expect(graphqlRootField("")).toBeUndefined();
    expect(graphqlRootField(undefined)).toBeUndefined();
    expect(graphqlRootField(42)).toBeUndefined();
  });
});

describe("describeToolCall", () => {
  test("a GraphQL query names what it is fetching", () => {
    expect(describeToolCall("graphql_query", { query: "{ events { id } }" })).toBe(
      "looking up events",
    );
  });

  test("falls back to the static label when args do not help", () => {
    expect(describeToolCall("graphql_query", { query: "???" })).toBe("looking up data");
    expect(describeToolCall("graphql_query")).toBe("looking up data");
  });

  test("writes name the record they act on", () => {
    expect(describeToolCall("create_event", { title: "Tech Halaqah" })).toBe(
      "creating event Tech Halaqah",
    );
    expect(describeToolCall("rsvp_event", { status: "going" })).toBe("RSVPing going");
  });

  test("github calls name the repo", () => {
    expect(
      describeToolCall("list_github_prs", { owner: "msocietyhq", repo: "community-os" }),
    ).toBe("reading PRs in msocietyhq/community-os");
    expect(describeToolCall("list_github_prs", { repo: "community-os" })).toBe(
      "reading PRs in community-os",
    );
  });

  test("long details are truncated", () => {
    const phrase = describeToolCall("create_event", { title: "A".repeat(200) });
    expect(phrase).toContain("…");
    expect(phrase.length).toBeLessThan(70);
  });

  test("multi-line details are flattened", () => {
    expect(describeToolCall("create_event", { title: "Tech\n\nHalaqah" })).toBe(
      "creating event Tech Halaqah",
    );
  });

  test("a slug names the record being changed", () => {
    expect(describeToolCall("update_event", { event_id: "tech-halaqah-aug" })).toBe(
      "updating event tech-halaqah-aug",
    );
    expect(describeToolCall("delete_project", { project_id: "ppm" })).toBe(
      "removing project ppm",
    );
  });

  /** A UUID tells a member reading along nothing, so it is dropped. */
  test("a raw UUID falls back to the plain label", () => {
    expect(
      describeToolCall("update_event", {
        event_id: "b73ebac4-ded0-436b-9bec-b7da73df38a9",
      }),
    ).toBe("updating the event");
    expect(
      describeToolCall("delete_venue", {
        venue_id: "B73EBAC4-DED0-436B-9BEC-B7DA73DF38A9",
      }),
    ).toBe("removing the venue");
  });

  test("unknown tools fall back to a readable name", () => {
    expect(describeToolCall("some_new_tool", { a: 1 })).toBe("some new tool");
  });
});

describe("stacking by phrase", () => {
  const settleTick = () => new Promise<void>((r) => setTimeout(r, 0));

  test("different lookups stack as separate lines", async () => {
    const sink = makeSink();
    const clock = makeScheduler();
    const progress = new SubagentProgress({
      sink: sink.sink,
      scheduler: clock.scheduler,
      minEditIntervalMs: 0,
    });

    const handle = progress.start("Members", "find people");
    clock.fire();
    await settleTick();
    handle.activity.toolStart("graphql_query", { query: "{ members { id } }" })();
    handle.activity.toolStart("graphql_query", { query: "{ events { id } }" })();
    await settleTick();

    const text = sink.current() ?? "";
    expect(text).toContain("↳ looking up members");
    expect(text).toContain("↳ looking up events");
  });

  test("repeating the same lookup collapses into a count", async () => {
    const sink = makeSink();
    const clock = makeScheduler();
    const progress = new SubagentProgress({
      sink: sink.sink,
      scheduler: clock.scheduler,
      minEditIntervalMs: 0,
    });

    const handle = progress.start("Members", "find people");
    clock.fire();
    await settleTick();
    const q = { query: "query Page { members { id } }" };
    handle.activity.toolStart("graphql_query", q)();
    handle.activity.toolStart("graphql_query", q)();
    await settleTick();

    expect(sink.current()).toContain("↳ looking up members ×2");
  });
});

describe("main-agent root entry", () => {
  /** DM behaviour: the main agent reports its own tool calls, not just sub-agents. */
  function withRoot() {
    const sink = makeSink();
    const progress = new SubagentProgress({
      sink: sink.sink,
      revealDelayMs: 0,
      minEditIntervalMs: 0,
    });
    // Verb pinned: it rotates per turn, and assertions shouldn't be a lottery.
    return { sink, progress, root: progress.rootActivity("Thinking") };
  }

  test("logs the main agent's own tool calls", async () => {
    const { sink, root } = withRoot();
    root.toolStart("recall_memory", { query: "aziz" })();
    await settle();
    expect(sink.current()).toContain("recall memory");
  });

  // The member's question is on screen directly above, so repeating it is noise.
  test("shows no task line for the root", async () => {
    const { sink, root } = withRoot();
    root.toolStart("chat_history", {})();
    await settle();
    expect(sink.current()).toContain("⏳ Thinking\n");
    expect(sink.current()).not.toContain("Thinking —");
  });

  // The heading counts sub-agents, and the root isn't one.
  test("suppresses the batch heading", async () => {
    const { sink, root } = withRoot();
    root.toolStart("chat_history", {})();
    await settle();
    expect(sink.current()).not.toContain("Running");
    expect(sink.current()).not.toContain("subagent");
  });

  test("nests sub-agents underneath the root", async () => {
    const { sink, root } = withRoot();
    const sub = root.start("Research", "rate limits");
    sub.activity.toolStart("web_search", { query: "rate limits" })();
    await settle();

    const lines = (sink.current() ?? "").split("\n");
    const rootLine = lines.findIndex((l) => l.includes("Thinking"));
    const subLine = lines.findIndex((l) => l.includes("Research"));
    expect(rootLine).toBeGreaterThanOrEqual(0);
    expect(subLine).toBeGreaterThan(rootLine);
    // Indented relative to the root, i.e. a child rather than a sibling.
    expect(lines[subLine]!.startsWith(" ")).toBe(true);
  });

  // The root has no natural completion point — the turn ending is its
  // completion, so finish() must settle it or it renders as still running.
  // The label is only interesting while it's happening; once settled what
  // matters is what it produced.
  test("drops the root line on settle, promoting its sub-agents", async () => {
    const { sink, root, progress } = withRoot();
    const sub = root.start("Research", "rate limits");
    await settle();
    sub.done("ok");
    await progress.finish();

    expect(sink.current()).not.toContain("Thinking");
    expect(sink.current()).toContain("✅ Research — rate limits");
    // Promoted to the top level rather than left indented under nothing.
    expect(sink.current()!.startsWith("✅")).toBe(true);
  });

  // Nothing survives the settle, and render() skips an empty text — which
  // would strand the last in-flight frame on screen.
  test("deletes the message when the root produced no sub-agents", async () => {
    const sink = makeSink();
    const deleted: number[] = [];
    const progress = new SubagentProgress({
      sink: { ...sink.sink, delete: async (id) => void deleted.push(id) },
      revealDelayMs: 0,
      minEditIntervalMs: 0,
    });
    const root = progress.rootActivity("Thinking");

    root.toolStart("chat_history", {})();
    await settle();
    expect(sink.current()).toContain("Thinking");

    await progress.finish();
    expect(deleted).toHaveLength(1);
  });

  test("a sink that cannot delete simply leaves the message", async () => {
    const { root, progress } = withRoot();
    root.toolStart("chat_history", {})();
    await settle();
    // makeSink has no delete — this must not throw.
    await progress.finish();
  });

  // Group behaviour must be untouched: no root, heading intact.
  test("a reporter without a root keeps the sub-agent heading", async () => {
    const sink = makeSink();
    const progress = new SubagentProgress({
      sink: sink.sink,
      revealDelayMs: 0,
      minEditIntervalMs: 0,
    });
    progress.start("Research", "rate limits");
    await settle();
    expect(sink.current()).toContain("Running 1 subagent");
  });
});

describe("SUBAGENT_TOOLS", () => {
  // Each of these already renders as a nested entry, so logging the call too
  // showed the same work twice — once as `↳ events`, once as "✅ Events — …".
  test("a sub-agent launcher is not logged as a main-agent tool call", async () => {
    const sink = makeSink();
    const progress = new SubagentProgress({
      sink: sink.sink,
      revealDelayMs: 0,
      minEditIntervalMs: 0,
    });
    const root = progress.rootActivity("Thinking");

    const tools = {
      events: {
        execute: async () => {
          root.start("Events", "list all events");
        },
      },
    } as unknown as Record<string, never>;

    const wrapped = trackToolCalls(tools, root, SUBAGENT_TOOLS);
    await (wrapped as Record<string, { execute: () => Promise<void> }>)
      .events!.execute();
    await settle();

    const text = sink.current() ?? "";
    expect(text).toContain("Events — list all events");
    // The `↳ events` line the wrapper would otherwise have added.
    expect(text).not.toContain("↳ events");
  });

  test("an ordinary tool is still logged", async () => {
    const sink = makeSink();
    const progress = new SubagentProgress({
      sink: sink.sink,
      revealDelayMs: 0,
      minEditIntervalMs: 0,
    });
    const root = progress.rootActivity("Thinking");

    const tools = {
      recall_memory: { execute: async () => {} },
    } as unknown as Record<string, never>;

    const wrapped = trackToolCalls(tools, root, SUBAGENT_TOOLS);
    await (wrapped as Record<string, { execute: () => Promise<void> }>)
      .recall_memory!.execute();
    await settle();

    expect(sink.current()).toContain("recall memory");
  });

  // Catches a rename: every entry must be a tool the progress display knows.
  test("every name is a labelled tool or a sub-agent delegate", () => {
    const delegates = ["events", "members", "venues", "projects", "research", "github"];
    for (const name of SUBAGENT_TOOLS) {
      const known = delegates.includes(name) || toolLabel(name) !== name;
      expect(known, `${name} is not a recognised tool`).toBe(true);
    }
  });
});

describe("reveal timing", () => {
  // A turn the model answers straight from context has nothing to report, and
  // used to flash "⏳ Pondering" for a moment before deleting itself.
  test("opening the root alone never posts a message", async () => {
    const sink = makeSink();
    const clock = makeScheduler();
    const progress = new SubagentProgress({
      sink: sink.sink,
      scheduler: clock.scheduler,
      minEditIntervalMs: 0,
    });

    progress.rootActivity("Pondering");
    expect(clock.pendingCount()).toBe(0);

    clock.fire();
    await settle();
    await progress.finish();

    expect(sink.sent).toEqual([]);
  });

  test("the first tool call arms the reveal", async () => {
    const sink = makeSink();
    const clock = makeScheduler();
    const progress = new SubagentProgress({
      sink: sink.sink,
      scheduler: clock.scheduler,
      minEditIntervalMs: 0,
    });

    const root = progress.rootActivity("Pondering");
    root.toolStart("recall_memory", {});
    expect(clock.pendingCount()).toBe(1);

    clock.fire();
    await settle();
    expect(sink.sent).toHaveLength(1);
  });
});

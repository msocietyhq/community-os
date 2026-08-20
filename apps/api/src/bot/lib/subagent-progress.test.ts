import { describe, expect, test } from "bun:test";
import {
  renderProgress,
  SubagentProgress,
  type Scheduler,
  trackToolCalls,
  toolLabel,
  MIN_EDIT_INTERVAL_MS,
  MAX_MESSAGE_CHARS,
  type ProgressSink,
  type SubagentBatch,
} from "./subagent-progress";

/** Captures every send/edit so the message's whole lifecycle can be asserted. */
function makeSink(options: { failSend?: boolean } = {}) {
  const sent: string[] = [];
  const edits: { messageId: number; text: string }[] = [];

  const sink: ProgressSink = {
    async send(text) {
      sent.push(text);
      return options.failSend ? null : 100;
    },
    async edit(messageId, text) {
      edits.push({ messageId, text });
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
        { name: "Events", query: "upcoming meetups", state: "running", activeTools: [], children: [] },
        { name: "Projects", query: "active projects", state: "running", activeTools: [], children: [] },
      ],
    ];
    expect(renderProgress(batches)).toBe(
      "<b>Running 2 subagents</b>\n" +
        "⏳ <b>Events</b> — upcoming meetups\n" +
        "⏳ <b>Projects</b> — active projects",
    );
  });

  test("a settled sub-agent keeps its task line and gains a checkmark", () => {
    const batches: SubagentBatch[] = [
      [{ name: "Events", query: "upcoming meetups", state: "done", detail: "3 meetups", activeTools: [], children: [] }],
    ];
    expect(renderProgress(batches)).toBe(
      "<b>Done — 1 subagent</b>\n✅ <b>Events</b> — upcoming meetups",
    );
  });

  test("the sub-agent's own answer is not shown", () => {
    const batches: SubagentBatch[] = [
      [{ name: "Events", query: "upcoming meetups", state: "done", detail: "3 meetups on 24 Aug", activeTools: [], children: [] }],
    ];
    expect(renderProgress(batches)).not.toContain("24 Aug");
  });

  test("a batch is still running while any member is", () => {
    const batches: SubagentBatch[] = [
      [
        { name: "Events", query: "meetups", state: "done", detail: "3 meetups", activeTools: [], children: [] },
        { name: "Projects", query: "projects", state: "running", activeTools: [], children: [] },
      ],
    ];
    expect(renderProgress(batches)).toContain("<b>Running 2 subagents</b>");
  });

  test("failures keep their reason, since the reply cannot explain the gap", () => {
    const batches: SubagentBatch[] = [
      [{ name: "GitHub", query: "list repos", state: "failed", detail: "rate limited", activeTools: [], children: [] }],
    ];
    expect(renderProgress(batches)).toBe(
      "<b>Done — 1 subagent</b>\n❌ <b>GitHub</b> — list repos (failed: rate limited)",
    );
  });

  test("later rounds are appended below finished ones", () => {
    const batches: SubagentBatch[] = [
      [{ name: "Events", query: "meetups", state: "done", detail: "3 meetups", activeTools: [], children: [] }],
      [{ name: "Members", query: "who is going", state: "running", activeTools: [], children: [] }],
    ];
    expect(renderProgress(batches)).toBe(
      "<b>Done — 1 subagent</b>\n" +
        "✅ <b>Events</b> — meetups\n" +
        "\n" +
        "<b>Running 1 subagent</b>\n" +
        "⏳ <b>Members</b> — who is going",
    );
  });

  test("multi-line tasks are flattened to one line", () => {
    const batches: SubagentBatch[] = [
      [{ name: "Events", query: "line one\n\nline two", state: "running", activeTools: [], children: [] }],
    ];
    expect(renderProgress(batches)).toContain("⏳ <b>Events</b> — line one line two");
  });

  test("long tasks are truncated", () => {
    const batches: SubagentBatch[] = [
      [{ name: "Events", query: "A".repeat(400), state: "running", activeTools: [], children: [] }],
    ];
    const line = renderProgress(batches).split("\n")[1] ?? "";
    expect(line).toContain("…");
    expect(line.length).toBeLessThan(100);
  });

  test("HTML in a running query is escaped", () => {
    const out = renderProgress([
      [{ name: "Events", query: "<b>hi</b> & bye", state: "running", activeTools: [], children: [] }],
    ]);
    expect(out).toContain("&lt;b&gt;hi&lt;/b&gt; &amp; bye");
    // Only the structural bold tags survive unescaped.
    expect(out.match(/<b>/g)).toHaveLength(2);
  });

  test("HTML in a failure reason is escaped", () => {
    const out = renderProgress([
      [{ name: "Events", query: "q", state: "failed", detail: "a & b <script>", activeTools: [], children: [] }],
    ]);
    expect(out).toContain("a &amp; b &lt;script&gt;");
    expect(out).not.toContain("<script>");
  });

  test("empty batches render nothing", () => {
    expect(renderProgress([])).toBe("");
    expect(renderProgress([[]])).toBe("");
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
    expect(sent[0]).toContain("<b>Running 1 subagent</b>");
    expect(sent[0]).toContain("⏳ <b>Events</b> — upcoming meetups");
  });

  test("sub-agents started together share one round", async () => {
    const { progress, sent, fire } = setup();

    progress.start("Events", "meetups");
    progress.start("Projects", "projects");
    fire();
    await settle();

    expect(sent[0]).toContain("<b>Running 2 subagents</b>");
  });

  test("the message is edited as each sub-agent settles", async () => {
    const { progress, current, fire, edits } = setup();

    const events = progress.start("Events", "meetups");
    const projects = progress.start("Projects", "projects");
    fire();
    await settle();

    events.done("3 meetups");
    await settle();
    expect(current()).toContain("✅ <b>Events</b> — meetups");
    expect(current()).toContain("<b>Running 2 subagents</b>");

    projects.done("12 projects");
    await settle();
    expect(current()).toContain("<b>Done — 2 subagents</b>");
    expect(current()).toContain("✅ <b>Projects</b> — projects");
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
      "<b>Done — 1 subagent</b>\n" +
        "✅ <b>Events</b> — meetups\n" +
        "\n" +
        "<b>Done — 1 subagent</b>\n" +
        "✅ <b>Members</b> — who is going",
    );
  });

  test("a sub-agent joining a running round is added to it", async () => {
    const { progress, current, fire } = setup();

    progress.start("Events", "meetups");
    fire();
    await settle();

    progress.start("Projects", "projects");
    await settle();

    expect(current()).toContain("<b>Running 2 subagents</b>");
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
    expect(text).toContain("✅ <b>Events</b> — meetups");
    expect(text).toContain("<b>Running 1 subagent</b>");
  });

  test("failures show in the final state", async () => {
    const { progress, current, fire } = setup();

    const handle = progress.start("GitHub", "list repos");
    fire();
    await settle();
    handle.failed("rate limited");
    await progress.finish();

    expect(current()).toContain("❌ <b>GitHub</b> — list repos (failed: rate limited)");
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

    expect(current()).toContain("✅ <b>Events</b> — meetups");
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

    expect(current()).toContain("⏳ <b>Events</b> — meetups\n    ↳ <i>looking up data</i>");
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
    expect(current()).toContain("↳ <i>looking up data</i>");
    expect(current()).toContain("⏳ <b>Events</b> — meetups");
  });

  test("parallel tool calls are listed together", async () => {
    const { progress, current, fire } = setup();

    const handle = progress.start("Events", "meetups");
    fire();
    await settle();

    handle.activity.toolStart("graphql_query");
    handle.activity.toolStart("rsvp_event");
    await settle();

    expect(current()).toContain("↳ <i>looking up data</i>, <i>RSVPing</i>");
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

    expect(current()).toContain("↳ <i>RSVPing</i>");
    expect(current()).not.toContain("looking up data");
  });

  test("the same tool running twice clears one at a time", async () => {
    const { progress, current, fire } = setup();

    const handle = progress.start("Events", "meetups");
    fire();
    await settle();

    const endA = handle.activity.toolStart("graphql_query");
    handle.activity.toolStart("graphql_query");
    await settle();
    endA();
    await settle();

    expect(current()).toContain("↳ <i>looking up data</i>");
    expect(current()).not.toContain("<i>looking up data</i>, <i>looking up data</i>");
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

    expect(current()).toContain("✅ <b>Events</b> — meetups");
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

    expect(current()).toContain("↳ <i>RSVPing</i>");
  });

  test("tool names are HTML-escaped", async () => {
    const { progress, current, fire } = setup();

    const handle = progress.start("Events", "meetups");
    fire();
    await settle();
    handle.activity.toolStart("<script>");
    await settle();

    expect(current()).toContain("&lt;script&gt;");
    expect(current()).not.toContain("<script>");
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
      "<b>Running 1 subagent</b>\n" +
        "⏳ <b>Events</b> — plan the meetup\n" +
        "    ⏳ <b>Venues</b> — find a room",
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
    expect(lines[1]).toBe("⏳ <b>Events</b> — plan the meetup");
    expect(lines[2]).toBe("    ⏳ <b>Venues</b> — find a room");
    expect(lines[3]).toBe("        ⏳ <b>Members</b> — who can host");
    expect(lines[4]).toBe("            ⏳ <b>GitHub</b> — check the rota repo");
  });

  test("a child's tools indent under the child", async () => {
    const { progress, current, fire } = setup();

    const parent = progress.start("Events", "plan the meetup");
    fire();
    await settle();
    const child = parent.activity.start("Venues", "find a room");
    child.activity.toolStart("graphql_query");
    await settle();

    expect(current()).toContain("    ⏳ <b>Venues</b> — find a room\n        ↳ <i>looking up data</i>");
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

    expect(current()).toContain("⏳ <b>Events</b> — plan the meetup");
    expect(current()).toContain("    ✅ <b>Venues</b> — find a room");
    expect(current()).toContain("<b>Running 1 subagent</b>");
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
      "<b>Done — 1 subagent</b>\n" +
        "✅ <b>Events</b> — plan the meetup\n" +
        "    ✅ <b>Venues</b> — find a room",
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

    expect(current()).toContain("<b>Running 1 subagent</b>");
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
    const text = renderProgress([[]]);
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
    expect(current()).toContain("<i>looking up data</i>");
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

    expect(edits).toHaveLength(1);
    expect(current()).toContain("<i>RSVPing</i>");
    expect(current()).not.toContain("looking up data");
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

    expect(current()).toContain("✅ <b>Events</b> — meetups");
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

  test("a newer tool replaces the previous one", async () => {
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

    expect(sink.current()).toContain("<i>RSVPing</i>");
    expect(sink.current()).not.toContain("looking up data");
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

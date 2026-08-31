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
  type SubagentEntry,
  type SubagentProgressOptions,
} from "./subagent-progress";

/** Progress renders to entities now; these assertions read the plain text. */
const render = (root: SubagentEntry | null) => renderProgress(root).text;

/** A sub-agent entry, with the boilerplate fields defaulted. */
function entry(
  partial: Partial<SubagentEntry> & { name: string; query: string },
): SubagentEntry {
  return { state: "running", activeTools: [], toolLog: [], children: [], ...partial };
}

/** The main agent's own entry, which heads every turn. */
function root(
  children: SubagentEntry[],
  state: SubagentEntry["state"] = "running",
  name = "Thinking",
): SubagentEntry {
  return { name, query: "", state, activeTools: [], toolLog: [], children };
}

/** Captures every send/edit/delete so the message's whole lifecycle can be asserted. */
function makeSink(options: { failSend?: boolean; withDelete?: boolean } = {}) {
  const sent: string[] = [];
  const edits: { messageId: number; text: string }[] = [];
  const deleted: number[] = [];

  const sink: ProgressSink = {
    async send(message) {
      sent.push(message.text);
      return options.failSend ? null : 100;
    },
    async edit(messageId, message) {
      edits.push({ messageId, text: message.text });
    },
    // `delete` is optional on the interface — a sink that omits it keeps the
    // message forever, which is what a DM wants. Passing `withDelete: false`
    // models that sink.
    ...(options.withDelete === false
      ? {}
      : {
          async delete(messageId: number) {
            deleted.push(messageId);
          },
        }),
  };

  return {
    sink,
    sent,
    edits,
    deleted,
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

/**
 * Opens a reporter with a pinned root, as every turn now does.
 *
 * The verb is pinned because it rotates per turn and assertions should not be
 * a lottery. `start` stands in for the old `progress.start`.
 */
function makeReporter(options: Partial<SubagentProgressOptions> = {}) {
  const sink = makeSink();
  const progress = new SubagentProgress({
    sink: sink.sink,
    revealDelayMs: 0,
    minEditIntervalMs: 0,
    ...options,
  });
  const rootActivity = progress.rootActivity("Thinking");
  return {
    sink,
    progress,
    root: rootActivity,
    start: (name: string, query: string) => rootActivity.start(name, query),
  };
}

/**
 * Pins a root on a reporter and exposes the sub-agent opener.
 *
 * Sub-agents hang off the turn's root now, so what tests used to call as
 * `progress.start` is `root.start`. The verb is pinned because it rotates per
 * turn and assertions should not be a lottery.
 */
function rooted(progress: SubagentProgress) {
  const root = progress.rootActivity("Thinking");
  return { root, start: (name: string, query: string) => root.start(name, query) };
}

// ─── renderProgress ──────────────────────────────────────────────────────────

describe("renderProgress", () => {
  test("a running turn heads the message and nests its sub-agents", () => {
    expect(
      render(
        root([
          entry({ name: "Events", query: "upcoming meetups" }),
          entry({ name: "Projects", query: "active projects" }),
        ]),
      ),
    ).toBe(
      "⏳ Thinking\n" +
        "    ⏳ Events — upcoming meetups\n" +
        "    ⏳ Projects — active projects",
    );
  });

  test("a settled sub-agent keeps its task line and gains a checkmark", () => {
    expect(
      render(root([entry({ name: "Events", query: "upcoming meetups", state: "done" })])),
    ).toBe("⏳ Thinking\n    ✅ Events — upcoming meetups");
  });

  test("the sub-agent's own answer is not shown", () => {
    expect(
      render(
        root([
          entry({
            name: "Events",
            query: "upcoming meetups",
            state: "done",
            detail: "3 events found",
          }),
        ]),
      ),
    ).not.toContain("3 events found");
  });

  test("failures keep their reason, since the reply cannot explain the gap", () => {
    expect(
      render(
        root([
          entry({ name: "Research", query: "rate limits", state: "failed", detail: "timed out" }),
        ]),
      ),
    ).toBe("⏳ Thinking\n    ❌ Research — rate limits (failed: timed out)");
  });

  test("a settled turn drops the root line and promotes its sub-agents", () => {
    expect(
      render(
        root(
          [
            entry({ name: "Events", query: "upcoming meetups", state: "done" }),
            entry({
              name: "Research",
              query: "rate limits",
              state: "failed",
              detail: "timed out",
            }),
          ],
          "done",
        ),
      ),
    ).toBe(
      "🏁 Completed\n" +
        "✅ Events — upcoming meetups\n" +
        "❌ Research — rate limits (failed: timed out)",
    );
  });

  test("a sub-agent that settled earlier renders as a sibling of a later one", () => {
    expect(
      render(
        root([
          entry({ name: "Events", query: "upcoming meetups", state: "done" }),
          entry({ name: "Members", query: "who is going" }),
        ]),
      ),
    ).toBe(
      "⏳ Thinking\n" +
        "    ✅ Events — upcoming meetups\n" +
        "    ⏳ Members — who is going",
    );
  });

  test("multi-line tasks are flattened to one line", () => {
    expect(render(root([entry({ name: "Events", query: "line one\nline two" })]))).toBe(
      "⏳ Thinking\n    ⏳ Events — line one line two",
    );
  });

  test("long tasks are truncated", () => {
    const out = render(root([entry({ name: "Events", query: "x".repeat(120) })]));
    expect(out).toContain("…");
    expect(out.length).toBeLessThan(120);
  });

  test("markup in a running query is left verbatim", () => {
    expect(render(root([entry({ name: "Events", query: "<b>bold</b> & co" })]))).toContain(
      "<b>bold</b> & co",
    );
  });

  test("markup in a failure reason is left verbatim", () => {
    expect(
      render(
        root([entry({ name: "Events", query: "q", state: "failed", detail: "<i>nope</i>" })]),
      ),
    ).toContain("<i>nope</i>");
  });

  test("the sub-agent name is bold, as an entity rather than markup", () => {
    const rendered = renderProgress(root([entry({ name: "Events", query: "upcoming meetups" })]));
    expect(rendered.text).not.toContain("<b>");
    const bold = rendered.entities
      .filter((e) => e.type === "bold")
      .map((e) => rendered.text.slice(e.offset, e.offset + e.length));
    expect(bold).toContain("Events");
  });

  test("no root renders nothing", () => {
    expect(render(null)).toBe("");
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
    const { start } = rooted(progress);
    return { ...sink, ...clock, progress, ...rooted(progress) };
  }

  test("a fast sub-agent never posts a message", async () => {
    const { progress, sent, edits, start } = setup();

    const handle = start("Events", "upcoming meetups");
    handle.done("3 meetups");
    await progress.finish();

    expect(sent).toEqual([]);
    expect(edits).toEqual([]);
  });

  test("a slow sub-agent posts once the reveal timer fires", async () => {
    const { progress, sent, fire, start } = setup();

    start("Events", "upcoming meetups");
    expect(sent).toEqual([]);

    fire();
    await settle();

    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain("⏳ Thinking");
    expect(sent[0]).toContain("⏳ Events — upcoming meetups");
  });

  test("the message is edited as each sub-agent settles", async () => {
    const { progress, current, fire, edits, start } = setup();

    const events = start("Events", "meetups");
    const projects = start("Projects", "projects");
    fire();
    await settle();

    events.done("3 meetups");
    await settle();
    expect(current()).toContain("✅ Events — meetups");
    expect(current()).toContain("⏳ Thinking");

    // Every sub-agent settling does not settle the turn — only finish() does,
    // so the root still heads the message here.
    projects.done("12 projects");
    await settle();
    expect(current()).toContain("⏳ Thinking");
    expect(current()).toContain("✅ Projects — projects");

    await progress.finish();
    expect(current()).toContain("🏁 Completed");
    expect(edits.every((e) => e.messageId === 100)).toBe(true);
  });

  test("failures show in the final state", async () => {
    const { progress, current, fire, start } = setup();

    const handle = start("GitHub", "list repos");
    fire();
    await settle();
    handle.failed("rate limited");
    await progress.finish();

    expect(current()).toContain("❌ GitHub — list repos (failed: rate limited)");
  });

  test("settling twice is ignored", async () => {
    const { progress, current, fire, start } = setup();

    const handle = start("Events", "meetups");
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
    const { progress, edits, fire, start } = setup();

    const handle = start("Events", "meetups");
    fire();
    await settle();

    handle.done("3 meetups");
    await settle();
    await progress.finish();
    const afterFinish = edits.length;

    // The same state rendered again must not go out a second time.
    await progress.finish();
    expect(edits.length).toBe(afterFinish);
  });

  test("finish is silent when nothing ever revealed", async () => {
    const { progress, sent, edits } = setup();
    await progress.finish();
    expect(sent).toEqual([]);
    expect(edits).toEqual([]);
  });

  test("finish cancels a pending reveal", async () => {
    const { progress, pendingCount, sent, start } = setup();

    const handle = start("Events", "meetups");
    handle.done("3 meetups");
    expect(pendingCount()).toBe(1);

    await progress.finish();
    expect(pendingCount()).toBe(0);
    expect(sent).toEqual([]);
  });

  test("a failed send is not retried on every update", async () => {
    const { progress, sent, edits, fire, start } = setup(true);

    const handle = start("Events", "meetups");
    fire();
    await settle();
    expect(sent).toHaveLength(1);

    handle.done("3 meetups");
    await progress.finish();

    expect(edits).toEqual([]);
    expect(sent).toHaveLength(1);
  });

  test("completedResults returns only successful output", async () => {
    const { progress, fire, start } = setup();

    const ok = start("Events", "meetups");
    const bad = start("GitHub", "repos");
    fire();
    await settle();

    ok.done("3 meetups");
    bad.failed("rate limited");
    await progress.finish();

    expect(progress.completedResults()).toEqual(["3 meetups"]);
  });

  // ── nested tool calls ─────────────────────────────────────────────────────

  test("a running sub-agent shows the tool it is calling", async () => {
    const { progress, current, fire, start } = setup();

    const handle = start("Events", "meetups");
    fire();
    await settle();

    handle.activity.toolStart("graphql_query");
    await settle();

    expect(current()).toContain("    ⏳ Events — meetups\n        ↳ looking up data");
  });

  test("the last tool stays on screen after it finishes", async () => {
    const { progress, current, fire, start } = setup();

    const handle = start("Events", "meetups");
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
    const { progress, current, fire, start } = setup();

    const handle = start("Events", "meetups");
    fire();
    await settle();

    handle.activity.toolStart("graphql_query");
    handle.activity.toolStart("rsvp_event");
    await settle();

    expect(current()).toContain("        ↳ looking up data\n        ↳ RSVPing");
  });

  test("ending one of two parallel tools leaves the other", async () => {
    const { progress, current, fire, start } = setup();

    const handle = start("Events", "meetups");
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
    const { progress, current, fire, start } = setup();

    const handle = start("Events", "meetups");
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
    const { progress, current, fire, start } = setup();

    const handle = start("Events", "plan it");
    fire();
    await settle();
    handle.activity.toolStart("graphql_query")();
    handle.activity.toolStart("create_event")();
    handle.activity.toolStart("rsvp_event");
    await settle();

    const lines = (current() ?? "").split("\n").filter((l) => l.includes("↳"));
    expect(lines).toEqual([
      "        ↳ looking up data",
      "        ↳ creating the event",
      "        ↳ RSVPing",
    ]);
  });

  test("a long stack folds the oldest entries away", async () => {
    const { progress, current, fire, start } = setup();

    const handle = start("Events", "plan it");
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
    const { progress, current, fire, start } = setup();

    const handle = start("Events", "plan it");
    fire();
    await settle();
    handle.activity.toolStart("graphql_query")();
    handle.activity.toolStart("create_event")();
    await settle();
    expect((current() ?? "").split("\n").filter((l) => l.includes("↳"))).toHaveLength(2);

    handle.done("event created");
    await progress.finish();

    expect(current()).toBe(
      "🏁 Completed\n✅ Events — plan it",
    );
  });

  test("a settled sub-agent shows no tool line", async () => {
    const { progress, current, fire, start } = setup();

    const handle = start("Events", "meetups");
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
    const { progress, current, fire, start } = setup();

    const handle = start("Events", "meetups");
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
    const { progress, current, fire, start } = setup();

    const handle = start("Events", "meetups");
    fire();
    await settle();
    handle.activity.toolStart("<script>");
    await settle();

    // Nothing is escaped because nothing is parsed — the text is sent as-is and
    // the styling travels as entities, so markup here is inert either way.
    expect(current()).toContain("<script>");
    expect(current()).not.toContain("&lt;");
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
    const { start } = rooted(progress);
    return { ...sink, ...clock, progress, ...rooted(progress) };
  }

  test("a sub-agent's children are indented beneath it", async () => {
    const { progress, current, fire, start } = setup();

    const parent = start("Events", "plan the meetup");
    fire();
    await settle();

    parent.activity.start("Venues", "find a room");
    await settle();

    expect(current()).toBe(
      "⏳ Thinking\n" +
        "    ⏳ Events — plan the meetup\n" +
        "        ⏳ Venues — find a room",
    );
  });

  test("nesting is not limited to one level", async () => {
    const { progress, current, fire, start } = setup();

    const a = start("Events", "plan the meetup");
    fire();
    await settle();
    const b = a.activity.start("Venues", "find a room");
    const c = b.activity.start("Members", "who can host");
    c.activity.start("GitHub", "check the rota repo");
    await settle();

    const lines = (current() ?? "").split("\n");
    expect(lines[0]).toBe("⏳ Thinking");
    expect(lines[1]).toBe("    ⏳ Events — plan the meetup");
    expect(lines[2]).toBe("        ⏳ Venues — find a room");
    expect(lines[3]).toBe("            ⏳ Members — who can host");
    expect(lines[4]).toBe("                ⏳ GitHub — check the rota repo");
  });

  test("a child's tools indent under the child", async () => {
    const { progress, current, fire, start } = setup();

    const parent = start("Events", "plan the meetup");
    fire();
    await settle();
    const child = parent.activity.start("Venues", "find a room");
    child.activity.toolStart("graphql_query");
    await settle();

    expect(current()).toContain("        ⏳ Venues — find a room\n            ↳ looking up data");
  });

  test("children settle independently of their parent", async () => {
    const { progress, current, fire, start } = setup();

    const parent = start("Events", "plan the meetup");
    fire();
    await settle();
    const child = parent.activity.start("Venues", "find a room");
    await settle();

    child.done("Room 3 is free");
    await settle();

    expect(current()).toContain("    ⏳ Events — plan the meetup");
    expect(current()).toContain("        ✅ Venues — find a room");
    expect(current()).toContain("⏳ Thinking");
  });

  test("a settled parent keeps showing its children", async () => {
    const { progress, current, fire, start } = setup();

    const parent = start("Events", "plan the meetup");
    fire();
    await settle();
    const child = parent.activity.start("Venues", "find a room");
    child.done("Room 3 is free");
    parent.done("Meetup planned");
    await progress.finish();

    expect(current()).toBe(
      "🏁 Completed\n" +
        "✅ Events — plan the meetup\n" +
        "    ✅ Venues — find a room",
    );
  });

  test("completedResults collects successes from every depth", async () => {
    const { progress, fire, start } = setup();

    const parent = start("Events", "plan the meetup");
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

  test("a deep tree is clamped to Telegram's message limit", async () => {
    const { current, fire, start } = setup();
    let handle = start("Root", "x".repeat(50));
    for (let i = 0; i < 200; i++) {
      handle = handle.activity.start(`Agent${i}`, "y".repeat(50));
    }
    fire();
    await settle();
    expect(current()!.length).toBeLessThanOrEqual(MAX_MESSAGE_CHARS + 2);
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
    const { start } = rooted(progress);
    return { ...sink, ...clock, progress, ...rooted(progress), advance: (ms: number) => { time += ms; } };
  }

  test("the first post is never delayed", async () => {
    const { progress, sent, fire, start } = setup();
    start("Events", "meetups");
    fire();
    await settle();
    expect(sent).toHaveLength(1);
  });

  test("edits inside the interval are deferred, not dropped", async () => {
    const { progress, edits, fire, advance, current, start } = setup();

    const handle = start("Events", "meetups");
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
    const { progress, edits, fire, advance, current, start } = setup();

    const handle = start("Events", "meetups");
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
    const { progress, edits, fire, advance, start } = setup();

    const handle = start("Events", "meetups");
    fire();
    await settle();

    advance(MIN_EDIT_INTERVAL_MS + 1);
    handle.activity.toolStart("graphql_query");
    await settle();

    expect(edits).toHaveLength(1);
  });

  test("finish bypasses the throttle so the end state lands immediately", async () => {
    const { progress, current, fire, start } = setup();

    const handle = start("Events", "meetups");
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
    const { start } = rooted(progress);
    const advance = (ms: number) => { time += ms; };
    const seen: string[] = [];
    const record = () => { const t = sink.current(); if (t) seen.push(t); };

    // Step 1 returns a tool call at ~1.0s — before the 1.5s reveal — and the
    // query is fast, so the tool is long finished by the time anything is
    // posted. This is the common shape: one tool call, early, short.
    const handle = start("Members", "find typescript people");
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
    const { start } = rooted(progress);

    const handle = start("Members", "find typescript people");
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
    const { start } = rooted(progress);

    const handle = start("Events", "plan it");
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
    const { start } = rooted(progress);

    const handle = start("Members", "find people");
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

    const { start } = rooted(progress);

    const handle = start("Members", "find people");
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
    const root = progress.rootActivity("Thinking");
    return {
      sink,
      progress,
      root,
      start: (name: string, query: string) => root.start(name, query),
    };
  }

  test("logs the main agent's own tool calls", async () => {
    const { sink, root, start } = withRoot();
    // A sub-agent is what reveals the message at all; the main agent's own
    // lookups are what this asserts show up alongside it.
    start("Research", "rate limits");
    root.toolStart("recall_memory", { query: "aziz" })();
    await settle();
    expect(sink.current()).toContain("recall memory");
  });

  // The member's question is on screen directly above, so repeating it is noise.
  test("shows no task line for the root", async () => {
    const { sink, root, start } = withRoot();
    start("Research", "rate limits");
    root.toolStart("chat_history", {})();
    await settle();
    expect(sink.current()).toContain("⏳ Thinking\n");
    expect(sink.current()).not.toContain("Thinking —");
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
    // Headed, with the work promoted to the top level rather than left
    // indented under nothing.
    expect(sink.current()!.startsWith("🏁 Completed\n")).toBe(true);
    expect(sink.current()).toContain("\n✅ Research — rate limits");
  });

  // The reveal is armed only by a sub-agent, and a sub-agent's entry is never
  // removed — so anything posted has something to show. That invariant is what
  // lets finish() have no deletion path at all.
  test("a posted message never renders empty", async () => {
    const { sink, start, progress } = makeReporter();

    start("Research", "rate limits").done("nothing found");
    await settle();
    await progress.finish();

    const texts = [...sink.sent, ...sink.edits.map((e) => e.text)];
    expect(texts.length).toBeGreaterThan(0);
    expect(texts.every((t) => t !== "")).toBe(true);
  });

  // The turn used to be able to end while the first send was still in flight,
  // leaving finish() reading a null messageId and stranding "⏳ Thinking" on
  // screen for good. With no deletion decision there is nothing to race.
  test("a turn ending mid-send still settles on the completed state", async () => {
    const sink = makeSink();
    const slow: ProgressSink = {
      ...sink.sink,
      async send(message) {
        await new Promise((r) => setTimeout(r, 5));
        return sink.sink.send(message);
      },
    };
    const progress = new SubagentProgress({
      sink: slow,
      revealDelayMs: 0,
      minEditIntervalMs: 0,
    });
    const root = progress.rootActivity("Thinking");
    const handle = root.start("Events", "upcoming meetups");

    // Lets the reveal fire, which starts the slow send. The turn then ends
    // while that send is still in the air.
    await settle();
    handle.done("3 events found");
    await progress.finish();
    await new Promise((r) => setTimeout(r, 20));

    expect(sink.current()).toBe("🏁 Completed\n✅ Events — upcoming meetups");
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

    // Reveals the message; without a sub-agent nothing is ever posted.
    root.start("Research", "rate limits");

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

  // A tool call is not on its own worth a message: in a DM the main agent's
  // own lookups are logged, but a turn that never delegates has nothing to
  // show beyond a verb.
  test("a tool call alone never arms the reveal", async () => {
    const sink = makeSink();
    const clock = makeScheduler();
    const progress = new SubagentProgress({
      sink: sink.sink,
      scheduler: clock.scheduler,
      minEditIntervalMs: 0,
    });

    const root = progress.rootActivity("Pondering");
    root.toolStart("recall_memory", {});
    expect(clock.pendingCount()).toBe(0);

    clock.fire();
    await settle();
    await progress.finish();

    expect(sink.sent).toEqual([]);
  });

  test("a sub-agent arms the reveal", async () => {
    const sink = makeSink();
    const clock = makeScheduler();
    const progress = new SubagentProgress({
      sink: sink.sink,
      scheduler: clock.scheduler,
      minEditIntervalMs: 0,
    });

    const root = progress.rootActivity("Pondering");
    root.start("Research", "rate limits");
    expect(clock.pendingCount()).toBe(1);

    clock.fire();
    await settle();
    expect(sink.sent).toHaveLength(1);
  });
});

describe("model label on the heading", () => {
  /** The turn's root, which is what carries the label while it runs. */
  const turn = (over: Partial<SubagentEntry> = {}): SubagentEntry => ({
    name: "Pondering",
    query: "",
    state: "running",
    activeTools: [],
    toolLog: [],
    children: [],
    ...over,
  });

  test("stamps the model beside the running heading", () => {
    const out = renderProgress(turn(), "DeepSeek V4 Flash").text;
    expect(out).toContain("Pondering — DeepSeek V4 Flash");
  });

  test("leaves the completed heading bare", () => {
    const out = renderProgress(
      turn({
        state: "done",
        children: [entry({ name: "Research", query: "latest AI news", state: "done" })],
      }),
      "DeepSeek V4 Flash",
    ).text;
    expect(out).toContain("Completed");
    expect(out).not.toContain("DeepSeek V4 Flash");
  });

  test("renders exactly as before when no model is given", () => {
    const out = renderProgress(turn()).text;
    expect(out).toContain("Pondering");
    expect(out).not.toContain("—");
  });

  // A group turn logs no main-agent tools of its own, so the head line is the
  // only thing that can carry the model. It used to render without a root at
  // all, which put the label out of reach there entirely.
  test("stamps the model when the root logged no tools of its own", () => {
    const out = renderProgress(
      turn({ children: [entry({ name: "Events", query: "upcoming meetups" })] }),
      "Sonnet 4.5",
    ).text;
    expect(out).toBe("⏳ Pondering — Sonnet 4.5\n    ⏳ Events — upcoming meetups");
  });

  // The label is italic; the heading stays bold. Telegram fails the whole
  // message if entity offsets drift, so assert the label is actually marked up.
  test("marks the model italic, not plain", () => {
    const rendered = renderProgress(turn(), "DeepSeek V4 Flash");
    const italic = rendered.entities.filter((e) => e.type === "italic");
    expect(italic).toHaveLength(1);
    expect(
      rendered.text.slice(italic[0]!.offset, italic[0]!.offset + italic[0]!.length),
    ).toBe("DeepSeek V4 Flash");
  });
});

// ─── status message cleanup ──────────────────────────────────────────────────

describe("status message cleanup", () => {
  function setup(options: { clearAfterMs?: number; withDelete?: boolean } = {}) {
    const sink = makeSink({ withDelete: options.withDelete });
    const clock = makeScheduler();
    const progress = new SubagentProgress({
      sink: sink.sink,
      scheduler: clock.scheduler,
      minEditIntervalMs: 0,
      clearAfterMs: options.clearAfterMs,
    });
    const { start } = rooted(progress);
    return { ...sink, ...clock, progress, start };
  }

  /**
   * Posts a message by opening a sub-agent and firing the reveal timer.
   * The render is queued, so `settle()` — not a bare microtask flush — is what
   * lets it land.
   */
  async function postAndFinish(s: ReturnType<typeof setup>) {
    const handle = s.start("Members", "who mentioned batteries");
    s.fire(); // reveal delay
    await settle();
    handle.done("nobody");
    await s.progress.finish();
  }

  test("a group's status message is deleted after the turn", async () => {
    const s = setup({ clearAfterMs: 60_000 });
    await postAndFinish(s);

    expect(s.sent).toHaveLength(1);
    expect(s.deleted).toEqual([]); // not yet — the timer hasn't fired

    s.fire();
    await settle();

    expect(s.deleted).toEqual([100]);
  });

  test("a DM's status message is left in place", async () => {
    const s = setup(); // no clearAfterMs
    await postAndFinish(s);

    expect(s.sent).toHaveLength(1);

    s.fire();
    await settle();

    expect(s.deleted).toEqual([]);
  });

  test("nothing is scheduled when no message was ever posted", async () => {
    const s = setup({ clearAfterMs: 60_000 });

    const handle = s.start("Members", "quick lookup");
    handle.done("done"); // settles before the reveal timer fires
    await s.progress.finish();

    expect(s.sent).toEqual([]);
    expect(s.pendingCount()).toBe(0);
    expect(s.deleted).toEqual([]);
  });

  test("a sink without delete is a no-op rather than a crash", async () => {
    const s = setup({ clearAfterMs: 60_000, withDelete: false });
    await postAndFinish(s);

    expect(s.sent).toHaveLength(1);

    s.fire();
    await settle();

    expect(s.deleted).toEqual([]);
  });
});

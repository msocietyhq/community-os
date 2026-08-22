/**
 * Live progress reporting for sub-agent work.
 *
 * The main agent can spend many seconds inside sub-agent tool calls with no
 * outward sign of life. This posts a single status message, edits it as work
 * settles, and leaves it in place showing what ran.
 *
 * Activity is a tree of arbitrary depth: a running sub-agent stacks up the
 * tools it has called and any sub-agents it spawns, which in turn show theirs.
 * The stack collapses when the sub-agent settles, leaving one line. Every node
 * carries a state marker — ⏳ running, ✅ done, ❌ failed.
 */

import type { Tool } from "ai";
import { FormattedString } from "@grammyjs/parse-mode";
import { clip } from "../../lib/text";
import type { EventsToolName } from "../ai/agents/events";
import type { MembersToolName } from "../ai/agents/members";
import type { VenuesToolName } from "../ai/agents/venues";
import type { ProjectsToolName } from "../ai/agents/projects";
import type { GithubToolName } from "../ai/agents/github";
import type { ResearchToolName } from "../ai/agents/research";

export type SubagentState = "running" | "done" | "failed";

export interface ToolCall {
  name: string;
  /** Rendered phrase, derived from the tool's arguments where possible. */
  phrase: string;
  /** Consecutive invocations of the same phrase, collapsed. */
  count: number;
}

export interface SubagentEntry {
  name: string;
  query: string;
  state: SubagentState;
  /** Result summary once done, or the error message when failed. */
  detail?: string;
  /** Tool calls currently in flight directly inside this sub-agent. */
  activeTools: string[];
  /**
   * Every tool this sub-agent has called, in order, with consecutive repeats
   * collapsed into a count.
   *
   * Kept rather than showing only what is in flight: sub-agents run for
   * seconds while their tool calls last a few hundred ms, so an in-flight-only
   * view is almost never on screen when an edit lands. Cleared on settle, so
   * the stack collapses away and a finished sub-agent is a single line.
   */
  toolLog: ToolCall[];
  /** Sub-agents spawned by this one, in start order. */
  children: SubagentEntry[];
  /**
   * The main agent's own entry, rather than a sub-agent.
   *
   * Renders without a task line (the member's question is already on screen
   * directly above) and suppresses the batch heading, which counts sub-agents
   * and would otherwise report the main agent as one.
   */
  isRoot?: boolean;
}

/** A round of sub-agents started together at the top level. */
export type SubagentBatch = SubagentEntry[];

export interface ProgressSink {
  /** Posts the status message; returns its id, or null if posting failed. */
  send(message: FormattedString): Promise<number | null>;
  edit(messageId: number, message: FormattedString): Promise<void>;
  /**
   * Removes the status message.
   *
   * Called when the final state has nothing left to report — a DM turn that
   * used only the main agent's own tools settles to an empty message, and
   * Telegram rejects an empty edit. Optional: a sink that can't delete simply
   * leaves the last frame on screen.
   */
  delete?(messageId: number): Promise<void>;
}

export interface Scheduler {
  /** Runs `fn` after `ms`; returns a cancel function. */
  schedule(fn: () => void, ms: number): () => void;
}

/**
 * Anything that can host sub-agent activity — the reporter itself, or a
 * sub-agent that is currently running. Uniform at every depth, so the same
 * wrapper works whether a sub-agent is spawned by the main agent or by
 * another sub-agent.
 */
export interface ProgressHost {
  start(name: string, query: string): SubagentHandle;
}

/** Reports what is running inside one sub-agent. */
export interface SubagentActivity extends ProgressHost {
  /**
   * Marks `name` as running; call the returned function when it finishes.
   * `args` are used only to describe the call — never stored or sent onward.
   */
  toolStart(name: string, args?: unknown): () => void;
}

export interface SubagentHandle {
  activity: SubagentActivity;
  done(result: string): void;
  failed(reason: string): void;
}

/**
 * How long work must run before the status message appears. Fast lookups
 * finish silently rather than flashing a message for half a second.
 */
/**
 * What the main agent's own line is called while it works.
 *
 * Rotated per turn purely for texture — the label carries no information, and
 * a fixed one gets stale when you see it several times an hour. Only ever
 * visible mid-flight: the line is dropped once the turn settles.
 */
export const THINKING_VERBS = [
  "Thinking",
  "Pondering",
  "Mulling",
  "Noodling",
  "Percolating",
  "Ruminating",
  "Deliberating",
  "Puzzling",
  "Musing",
  "Cogitating",
] as const;

export function pickThinkingVerb(
  random: () => number = Math.random,
): string {
  const index = Math.floor(random() * THINKING_VERBS.length);
  return THINKING_VERBS[index] ?? THINKING_VERBS[0];
}

export const REVEAL_DELAY_MS = 1500;

/** Telegram rejects messages over 4096 characters; stay well clear. */
export const MAX_MESSAGE_CHARS = 3500;

/**
 * Minimum gap between edits of the status message.
 *
 * Renders already coalesce while a request is in flight, so this covers the
 * remaining case: events arriving just after an edit lands, each triggering
 * another. A floor bounds the edit rate no matter how busy the tree gets;
 * a plain debounce would not, and would also delay the final state.
 */
export const MIN_EDIT_INTERVAL_MS = 500;

/** Most tool lines to show per sub-agent before folding the oldest away. */
const MAX_TOOL_LINES = 5;

const QUERY_MAX = 60;
const FAILURE_MAX = 80;
const INDENT = "    ";

const realScheduler: Scheduler = {
  schedule(fn, ms) {
    const timer = setTimeout(fn, ms);
    return () => clearTimeout(timer);
  },
};

/** Collapses to a single line and clips. No escaping: styling is entities. */
function oneLine(text: string, max: number): string {
  return clip(text.replace(/\s+/g, " ").trim(), max);
}

function plural(count: number): string {
  return count === 1 ? "subagent" : "subagents";
}

/**
 * Every tool that can appear in the status message — the union of all
 * sub-agent toolsets. Type-only imports, so no runtime dependency on the
 * agents (which import back into this module).
 */
/** Advisors are reachable from every sub-agent toolset, so they're labelled too. */
type AdvisorToolName = "big_brain_advisor" | "bigger_brain_advisor" | "ask_user" | "ai_usage";

export type TrackedToolName =
  | AdvisorToolName
  | EventsToolName
  | MembersToolName
  | VenuesToolName
  | ProjectsToolName
  | GithubToolName
  | ResearchToolName;

/**
 * Human-readable names for tool calls. Members shouldn't have to read internal
 * identifiers to follow along.
 *
 * Typed as a total `Record`, so adding a tool to any sub-agent fails the build
 * until it is given a label here, and a label for a tool that no longer exists
 * fails too.
 */
const TOOL_LABELS: Record<TrackedToolName, string> = {
  graphql_query: "looking up data",

  rsvp_event: "RSVPing",
  create_event: "creating the event",
  update_event: "updating the event",
  delete_event: "cancelling the event",

  create_venue: "adding the venue",
  update_venue: "updating the venue",
  delete_venue: "removing the venue",

  create_project: "creating the project",
  update_project: "updating the project",
  delete_project: "removing the project",
  add_project_member: "adding a project member",
  remove_project_member: "removing a project member",

  get_my_profile: "reading your profile",
  update_my_profile: "updating your profile",
  get_my_reputation: "checking your reputation",
  get_reputation: "checking reputation",
  get_leaderboard: "reading the leaderboard",

  ask_user: "asking you a question",
  ai_usage: "checking AI usage",
  big_brain_advisor: "consulting a stronger model",
  bigger_brain_advisor: "consulting the deepest model",

  web_search: "searching the web",
  fetch_url: "reading a page",
  hacker_news_search: "searching Hacker News",
  github_search_repos: "searching GitHub",

  get_github_org: "reading the GitHub org",
  get_github_repo: "reading the repo",
  list_github_repos: "listing repos",
  list_github_issues: "reading issues",
  list_github_prs: "reading pull requests",
};

/**
 * Falls back to the raw name with underscores removed. Unreachable for tools
 * in the union above, but `trackToolCalls` is generic and a caller could wrap
 * a toolset this map doesn't cover.
 */
export function toolLabel(name: string): string {
  return TOOL_LABELS[name as TrackedToolName] ?? name.replace(/_/g, " ");
}

const DETAIL_MAX = 40;

function short(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const flat = value.replace(/\s+/g, " ").trim();
  if (flat === "") return undefined;
  return flat.length > DETAIL_MAX ? `${flat.slice(0, DETAIL_MAX)}…` : flat;
}

/**
 * The first root field of a GraphQL document, e.g. `events` from
 * `query Upcoming { events(limit: 5) { items { id } } }`.
 *
 * "looking up data" is true of every query; the root field is what the member
 * actually cares about.
 */
export function graphqlRootField(query: unknown): string | undefined {
  if (typeof query !== "string") return undefined;
  const brace = query.indexOf("{");
  if (brace === -1) return undefined;
  const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)/.exec(query.slice(brace + 1));
  return match?.[1];
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A human-meaningful identifier, or nothing.
 *
 * These tools accept "UUID or slug". A slug names the thing; a UUID is noise
 * to a member reading along, so it is dropped and the caller falls back to the
 * plain label.
 */
function identifier(value: unknown): string | undefined {
  const text = short(value);
  if (!text || UUID_RE.test(text)) return undefined;
  return text;
}

type Args = Record<string, unknown>;

/**
 * Turns a tool call into a phrase naming what it is acting on. Returning
 * undefined falls back to the tool's static label.
 */
const TOOL_PHRASES: Partial<Record<TrackedToolName, (args: Args) => string | undefined>> = {
  graphql_query: (a) => {
    const field = graphqlRootField(a.query);
    return field ? `looking up ${field.replace(/_/g, " ")}` : undefined;
  },

  rsvp_event: (a) => {
    const status = short(a.status);
    return status ? `RSVPing ${status}` : undefined;
  },
  create_event: (a) => wrap("creating event", short(a.title)),
  update_event: (a) => wrap("updating event", identifier(a.event_id)),
  delete_event: (a) => wrap("cancelling event", identifier(a.event_id)),

  create_venue: (a) => wrap("adding venue", short(a.name)),
  update_venue: (a) => wrap("updating venue", identifier(a.venue_id)),
  delete_venue: (a) => wrap("removing venue", identifier(a.venue_id)),

  create_project: (a) => wrap("creating project", short(a.name)),
  update_project: (a) => wrap("updating project", identifier(a.project_id)),
  delete_project: (a) => wrap("removing project", identifier(a.project_id)),

  get_reputation: (a) => wrap("checking reputation for", short(a.username)),
  update_my_profile: () => undefined,

  get_github_repo: (a) => wrap("reading repo", repoRef(a)),
  list_github_issues: (a) => wrap("reading issues in", repoRef(a)),
  list_github_prs: (a) => wrap("reading PRs in", repoRef(a)),
  list_github_repos: (a) => wrap("listing repos in", short(a.owner)),
  get_github_org: (a) => wrap("reading org", short(a.owner)),

  web_search: (a) => wrap("searching for", short(a.query)),
  hacker_news_search: (a) =>
    wrap(a.kind === "comment" ? "reading HN opinions on" : "searching HN for", short(a.query)),
  github_search_repos: (a) => wrap("searching GitHub for", short(a.query)),
  fetch_url: (a) => {
    const raw = short(a.url);
    if (!raw) return undefined;
    try {
      return `reading ${new URL(raw).hostname}`;
    } catch {
      return undefined;
    }
  },
};

function wrap(prefix: string, detail: string | undefined): string | undefined {
  return detail ? `${prefix} ${detail}` : undefined;
}

function repoRef(args: Args): string | undefined {
  const repo = short(args.repo);
  if (!repo) return undefined;
  const owner = short(args.owner);
  return owner ? `${owner}/${repo}` : repo;
}

/** Phrase describing a tool call, using its arguments when they help. */
export function describeToolCall(name: string, args?: unknown): string {
  const build = TOOL_PHRASES[name as TrackedToolName];
  if (build && args && typeof args === "object") {
    const phrase = build(args as Args);
    if (phrase) return phrase;
  }
  return toolLabel(name);
}

/**
 * Renders one sub-agent and everything beneath it.
 *
 * The task line persists for the whole lifecycle and only the marker changes.
 * A sub-agent's own answer is deliberately not shown — the main agent's reply
 * covers that, and repeating it here reads as noise.
 */
function renderEntry(entry: SubagentEntry, depth: number): FormattedString[] {
  const pad = INDENT.repeat(depth);
  const name = FormattedString.b(entry.name);
  const task = oneLine(entry.query, QUERY_MAX);
  // The root entry has no task line — the member's question is on screen just
  // above it, so repeating it is noise.
  const suffix = entry.query ? ` — ${task}` : "";

  const lines: FormattedString[] = [];

  if (entry.state === "running") {
    lines.push(new FormattedString(`${pad}⏳ `).concat(name).plain(suffix));

    // Newest last, oldest folded away — the recent calls are what matter.
    const shown = entry.toolLog.slice(-MAX_TOOL_LINES);
    const hidden = entry.toolLog.length - shown.length;

    if (hidden > 0) {
      lines.push(new FormattedString(`${pad}${INDENT}↳ …${hidden} earlier`));
    }
    for (const call of shown) {
      const times = call.count > 1 ? ` ×${call.count}` : "";
      lines.push(
        new FormattedString(`${pad}${INDENT}↳ `).i(call.phrase).plain(times),
      );
    }
  } else if (entry.state === "failed") {
    // The reason is kept: it explains a gap the reply can't.
    const why = oneLine(entry.detail ?? "unknown error", FAILURE_MAX);
    lines.push(
      new FormattedString(`${pad}❌ `)
        .concat(name)
        .plain(`${suffix} (failed: ${why})`),
    );
  } else {
    lines.push(new FormattedString(`${pad}✅ `).concat(name).plain(suffix));
  }

  for (const child of entry.children) {
    lines.push(...renderEntry(child, depth + 1));
  }

  return lines;
}

function renderBatch(batch: SubagentBatch): FormattedString {
  const root = batch.find((e) => e.isRoot);
  if (root) {
    // No heading: it counts sub-agents, and the root isn't one.
    //
    // Once settled the root line itself is dropped — "Thinking" is only
    // interesting while it's happening. What survives is what it actually
    // produced, promoted to the top level. A root that produced nothing
    // renders empty, and finish() deletes the message.
    const entries =
      root.state === "running"
        ? renderEntry(root, 0)
        : root.children.flatMap((child) => renderEntry(child, 0));

    return FormattedString.join(entries, "\n");
  }

  const entries = batch.flatMap((e) => renderEntry(e, 0));
  const settled = batch.every((e) => e.state !== "running");
  const heading = FormattedString.b(
    settled
      ? `Done — ${batch.length} ${plural(batch.length)}`
      : `Running ${batch.length} ${plural(batch.length)}`,
  );

  return FormattedString.join([heading, ...entries], "\n");
}

/**
 * Renders every round, oldest first. Finished rounds keep their end state and
 * new rounds are appended below, so the message reads as a running log.
 *
 * Deep trees can outgrow Telegram's message limit, so the result is clamped.
 */
export function renderProgress(batches: SubagentBatch[]): FormattedString {
  const rendered = FormattedString.join(
    batches
      .filter((b) => b.length > 0)
      .map(renderBatch)
      // A settled root with no sub-agents renders to nothing; without this it
      // would contribute a blank line between the batches around it.
      .filter((b) => b.text.length > 0),
    "\n\n",
  );

  if (rendered.text.length <= MAX_MESSAGE_CHARS) return rendered;
  // `slice` carries the entities and trims any that straddle the cut.
  return rendered.slice(0, MAX_MESSAGE_CHARS).plain("\n…");
}

export interface SubagentProgressOptions {
  sink: ProgressSink;
  scheduler?: Scheduler;
  revealDelayMs?: number;
  minEditIntervalMs?: number;
  /** Injectable clock, so throttling is deterministic under test. */
  now?: () => number;
}

export class SubagentProgress implements ProgressHost {
  private readonly sink: ProgressSink;
  private readonly scheduler: Scheduler;
  private readonly revealDelayMs: number;
  private readonly minEditIntervalMs: number;
  private readonly now: () => number;

  private readonly batches: SubagentBatch[] = [];
  private messageId: number | null = null;
  private lastText: string | null = null;
  private revealed = false;
  private cancelReveal: (() => void) | null = null;
  private rendering = false;
  private renderPending = false;
  /** Latches once the sink can't post, so a broken chat isn't retried per update. */
  private sendFailed = false;
  private lastEditAt = 0;
  private cancelThrottle: (() => void) | null = null;

  constructor(options: SubagentProgressOptions) {
    this.sink = options.sink;
    this.scheduler = options.scheduler ?? realScheduler;
    this.revealDelayMs = options.revealDelayMs ?? REVEAL_DELAY_MS;
    this.minEditIntervalMs = options.minEditIntervalMs ?? MIN_EDIT_INTERVAL_MS;
    this.now = options.now ?? Date.now;
  }

  /** True once any sub-agent has been registered. */
  get started(): boolean {
    return this.batches.length > 0;
  }

  /**
   * Registers a top-level sub-agent. Sub-agents started while a previous round
   * is still in flight join that round; otherwise a new round opens.
   */
  start(name: string, query: string): SubagentHandle {
    const current = this.batches.at(-1);
    const openBatch =
      current && current.some((e) => e.state === "running") ? current : undefined;

    const batch = openBatch ?? [];
    if (!openBatch) this.batches.push(batch);

    const entry = newEntry(name, query);
    batch.push(entry);

    this.armReveal();
    return this.createHandle(entry);
  }

  /**
   * Opens the main agent's own entry and returns its activity.
   *
   * Used in DMs only. Because `SubagentActivity extends ProgressHost`, handing
   * this back as `ctx.progress` makes every sub-agent nest underneath it with
   * no change at the call sites — the same recursion that already handles
   * sub-agents spawning sub-agents.
   *
   * Not settled explicitly: `finish()` renders the final state, and a root
   * left running reads correctly as "this is what it did".
   */
  rootActivity(name: string = pickThinkingVerb()): SubagentActivity {
    const entry: SubagentEntry = { ...newEntry(name, ""), isRoot: true };
    this.batches.push([entry]);
    this.armReveal();
    return this.createHandle(entry).activity;
  }

  /** Successful results from every depth, for when the main agent produces no text. */
  completedResults(): string[] {
    const out: string[] = [];
    const walk = (entries: SubagentEntry[]) => {
      for (const entry of entries) {
        if (entry.state === "done" && entry.detail) out.push(entry.detail);
        walk(entry.children);
      }
    };
    walk(this.batches.flat());
    return out;
  }

  /**
   * Renders the final state. Call once the main agent is finished — if nothing
   * ever ran long enough to reveal the message, nothing is posted.
   */
  async finish(): Promise<void> {
    this.cancelReveal?.();
    this.cancelReveal = null;
    this.cancelThrottle?.();
    this.cancelThrottle = null;

    if (!this.revealed && this.messageId === null) return;

    // The root has no natural completion point — the turn ending IS its
    // completion. Settle it here or the final message shows it still running.
    for (const entry of this.batches.flat()) {
      if (entry.isRoot && entry.state === "running") {
        entry.state = "done";
        entry.activeTools = [];
        entry.toolLog = [];
      }
    }

    this.revealed = true;

    // Nothing left to report — a DM turn whose main agent used only its own
    // tools. render() skips an empty text, which would strand the last
    // in-flight frame on screen, so remove the message instead.
    if (renderProgress(this.batches).text === "" && this.messageId !== null) {
      const messageId = this.messageId;
      this.messageId = null;
      await this.sink.delete?.(messageId).catch(() => {});
      return;
    }

    // The end state should land immediately, not wait out the throttle.
    await this.render(true);
  }

  /** Builds the handle for an entry, wiring nesting to the same machinery. */
  private createHandle(entry: SubagentEntry): SubagentHandle {
    void this.render();

    const settle = (state: SubagentState, detail: string) => {
      if (entry.state !== "running") return;
      entry.state = state;
      entry.detail = detail;
      entry.activeTools = [];
      entry.toolLog = [];
      void this.render();
    };

    const activity: SubagentActivity = {
      toolStart: (toolName, args) => {
        if (entry.state !== "running") return () => {};
        entry.activeTools = [...entry.activeTools, toolName];

        const phrase = describeToolCall(toolName, args);
        const last = entry.toolLog.at(-1);
        // Collapse only identical phrases — two different lookups are two
        // different lines even though they share a tool name.
        if (last && last.name === toolName && last.phrase === phrase) {
          last.count++;
        } else {
          entry.toolLog.push({ name: toolName, phrase, count: 1 });
        }

        void this.render();

        let ended = false;
        return () => {
          if (ended) return;
          ended = true;
          const remaining = [...entry.activeTools];
          const at = remaining.indexOf(toolName);
          if (at !== -1) remaining.splice(at, 1);
          entry.activeTools = remaining;
          void this.render();
        };
      },

      // Nested sub-agents attach to this entry and behave identically, so
      // depth is unbounded without any special-casing.
      start: (childName, childQuery) => {
        const child = newEntry(childName, childQuery);
        entry.children.push(child);
        this.armReveal();
        return this.createHandle(child);
      },
    };

    return {
      activity,
      done: (result) => settle("done", result),
      failed: (reason) => settle("failed", reason),
    };
  }

  private armReveal(): void {
    if (this.revealed || this.cancelReveal) return;

    this.cancelReveal = this.scheduler.schedule(() => {
      this.cancelReveal = null;
      this.revealed = true;
      void this.render();
    }, this.revealDelayMs);
  }

  /**
   * Posts or edits the status message, coalescing concurrent requests so a
   * burst of activity produces one edit rather than several.
   */
  private async render(force = false): Promise<void> {
    if (!this.revealed || this.sendFailed) return;

    if (this.rendering) {
      this.renderPending = true;
      return;
    }

    // Space out edits. The first post is never delayed — that is the message
    // appearing at all, and the reveal delay has already gated it.
    if (!force && this.messageId !== null) {
      const since = this.now() - this.lastEditAt;
      if (since < this.minEditIntervalMs) {
        if (!this.cancelThrottle) {
          this.cancelThrottle = this.scheduler.schedule(() => {
            this.cancelThrottle = null;
            void this.render();
          }, this.minEditIntervalMs - since);
        }
        return;
      }
    }

    this.rendering = true;
    try {
      do {
        this.renderPending = false;

        const message = renderProgress(this.batches);
        const text = message.text;
        if (text === "" || text === this.lastText) break;

        if (this.messageId === null) {
          this.messageId = await this.sink.send(message);
          // Couldn't post at all — give up rather than retrying per update.
          if (this.messageId === null) {
            this.sendFailed = true;
            break;
          }
        } else {
          await this.sink.edit(this.messageId, message);
        }

        this.lastEditAt = this.now();
        this.lastText = text;
      } while (this.renderPending);
    } catch (err) {
      console.error("[subagent-progress] render failed:", err);
    } finally {
      this.rendering = false;
    }
  }
}

function newEntry(name: string, query: string): SubagentEntry {
  return { name, query, state: "running", activeTools: [], toolLog: [], children: [] };
}

/**
 * Wraps every tool in a sub-agent's toolset so it reports while it runs.
 *
 * Returns the toolset untouched when there is nothing to report to, so the
 * sub-agents behave identically outside the chat handler.
 */
export function trackToolCalls<T extends Record<string, Tool>>(
  tools: T,
  activity: SubagentActivity | undefined,
): T {
  if (!activity) return tools;

  const tracked: Record<string, Tool> = {};

  for (const [name, definition] of Object.entries(tools)) {
    const run = definition.execute;
    if (!run) {
      tracked[name] = definition;
      continue;
    }

    tracked[name] = {
      ...definition,
      execute: async (args: never, options: never) => {
        const finished = activity.toolStart(name, args);
        try {
          return await run(args, options);
        } finally {
          finished();
        }
      },
    } as Tool;
  }

  return tracked as T;
}

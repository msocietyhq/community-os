/**
 * Live progress reporting for sub-agent work.
 *
 * The main agent can spend many seconds inside sub-agent tool calls with no
 * outward sign of life. This posts a single status message, edits it as work
 * settles, and leaves it in place showing what ran.
 *
 * Activity is a tree of arbitrary depth: a sub-agent shows the tool it is
 * working on and any sub-agents it spawns, which in turn show theirs. Every
 * node carries a state marker — ⏳ running, ✅ done, ❌ failed.
 */

import type { Tool } from "ai";
import type { EventsToolName } from "../ai/agents/events";
import type { MembersToolName } from "../ai/agents/members";
import type { VenuesToolName } from "../ai/agents/venues";
import type { ProjectsToolName } from "../ai/agents/projects";
import type { GithubToolName } from "../ai/agents/github";

export type SubagentState = "running" | "done" | "failed";

export interface SubagentEntry {
  name: string;
  query: string;
  state: SubagentState;
  /** Result summary once done, or the error message when failed. */
  detail?: string;
  /** Tool calls currently in flight directly inside this sub-agent. */
  activeTools: string[];
  /**
   * The most recent tool, kept after it finishes so the line stays on screen.
   * Sub-agents run for seconds but their tool calls last a few hundred ms and
   * often complete before the message is even posted; without this the line
   * is almost never visible when an edit lands.
   */
  lastTool?: string;
  /** Sub-agents spawned by this one, in start order. */
  children: SubagentEntry[];
}

/** A round of sub-agents started together at the top level. */
export type SubagentBatch = SubagentEntry[];

export interface ProgressSink {
  /** Posts the status message; returns its id, or null if posting failed. */
  send(text: string): Promise<number | null>;
  edit(messageId: number, text: string): Promise<void>;
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
  /** Marks `name` as running; call the returned function when it finishes. */
  toolStart(name: string): () => void;
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

const QUERY_MAX = 60;
const FAILURE_MAX = 80;
const INDENT = "    ";

const realScheduler: Scheduler = {
  schedule(fn, ms) {
    const timer = setTimeout(fn, ms);
    return () => clearTimeout(timer);
  },
};

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function oneLine(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  const clipped = flat.length > max ? `${flat.slice(0, max)}…` : flat;
  return escapeHtml(clipped);
}

function plural(count: number): string {
  return count === 1 ? "subagent" : "subagents";
}

/**
 * Every tool that can appear in the status message — the union of all
 * sub-agent toolsets. Type-only imports, so no runtime dependency on the
 * agents (which import back into this module).
 */
export type TrackedToolName =
  | EventsToolName
  | MembersToolName
  | VenuesToolName
  | ProjectsToolName
  | GithubToolName;

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

/**
 * Renders one sub-agent and everything beneath it.
 *
 * The task line persists for the whole lifecycle and only the marker changes.
 * A sub-agent's own answer is deliberately not shown — the main agent's reply
 * covers that, and repeating it here reads as noise.
 */
function renderEntry(entry: SubagentEntry, depth: number): string[] {
  const pad = INDENT.repeat(depth);
  const name = `<b>${escapeHtml(entry.name)}</b>`;
  const task = oneLine(entry.query, QUERY_MAX);

  const lines: string[] = [];

  if (entry.state === "running") {
    lines.push(`${pad}⏳ ${name} — ${task}`);

    // Prefer what is running now; otherwise keep showing what ran last.
    const shown =
      entry.activeTools.length > 0
        ? entry.activeTools
        : entry.lastTool
          ? [entry.lastTool]
          : [];

    if (shown.length > 0) {
      const tools = shown.map((t) => `<i>${escapeHtml(toolLabel(t))}</i>`).join(", ");
      lines.push(`${pad}${INDENT}↳ ${tools}`);
    }
  } else if (entry.state === "failed") {
    // The reason is kept: it explains a gap the reply can't.
    const why = oneLine(entry.detail ?? "unknown error", FAILURE_MAX);
    lines.push(`${pad}❌ ${name} — ${task} (failed: ${why})`);
  } else {
    lines.push(`${pad}✅ ${name} — ${task}`);
  }

  for (const child of entry.children) {
    lines.push(...renderEntry(child, depth + 1));
  }

  return lines;
}

function renderBatch(batch: SubagentBatch): string {
  const settled = batch.every((e) => e.state !== "running");
  const heading = settled
    ? `<b>Done — ${batch.length} ${plural(batch.length)}</b>`
    : `<b>Running ${batch.length} ${plural(batch.length)}</b>`;

  return [heading, ...batch.flatMap((e) => renderEntry(e, 0))].join("\n");
}

/**
 * Renders every round, oldest first. Finished rounds keep their end state and
 * new rounds are appended below, so the message reads as a running log.
 *
 * Deep trees can outgrow Telegram's message limit, so the result is clamped.
 */
export function renderProgress(batches: SubagentBatch[]): string {
  const text = batches
    .filter((b) => b.length > 0)
    .map(renderBatch)
    .join("\n\n");

  if (text.length <= MAX_MESSAGE_CHARS) return text;
  return `${text.slice(0, MAX_MESSAGE_CHARS)}\n…`;
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

    this.revealed = true;
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
      entry.lastTool = undefined;
      void this.render();
    };

    const activity: SubagentActivity = {
      toolStart: (toolName) => {
        if (entry.state !== "running") return () => {};
        entry.activeTools = [...entry.activeTools, toolName];
        entry.lastTool = toolName;
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

        const text = renderProgress(this.batches);
        if (text === "" || text === this.lastText) break;

        if (this.messageId === null) {
          this.messageId = await this.sink.send(text);
          // Couldn't post at all — give up rather than retrying per update.
          if (this.messageId === null) {
            this.sendFailed = true;
            break;
          }
        } else {
          await this.sink.edit(this.messageId, text);
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
  return { name, query, state: "running", activeTools: [], children: [] };
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
        const finished = activity.toolStart(name);
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

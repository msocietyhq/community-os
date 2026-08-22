import { z } from "zod";
import { aiService } from "./ai.service";
import { env } from "../env";
import { clip } from "../lib/text";

const EXA_SEARCH_URL = "https://api.exa.ai/search";
const GITHUB_API = "https://api.github.com";
const HN_SEARCH_URL = "https://hn.algolia.com/api/v1/search";
const FETCH_TIMEOUT_MS = 15_000;

/** Per-result excerpt budget. Enough for the model to judge relevance. */
const EXCERPT_MAX = 600;

/** Repos older than this aren't "rising" however much they're discussed. */
const MAX_REPO_AGE_MONTHS = 24;

/** Below this, a repo is noise rather than something anyone is using yet. */
const MIN_REPO_STARS = 25;

/** Ceiling on GitHub enrichment calls per run, to stay clear of rate limits. */
const MAX_REPO_ENRICHMENTS = 14;

/** HN score below which a story isn't really "top of Hacker News". */
const MIN_HN_POINTS = 40;

type Section = "global" | "local" | "islamic";

const SEARCH_QUERIES: { section: Section; query: string }[] = [
  {
    section: "global",
    query: "notable software engineering and developer tooling news this week",
  },
  {
    section: "global",
    query: "significant AI and LLM releases or research this week",
  },
  {
    section: "local",
    query:
      "Singapore and Southeast Asia tech startup funding, hiring and product news this week",
  },
  {
    section: "islamic",
    query:
      "Islamic fintech, halal startup and Muslim founder technology news this week",
  },
];

/**
 * Deliberately spread across domains. A single "gaining traction" query returns
 * nothing but AI agent wrappers, because that is what the web is currently
 * writing about — the spread is what keeps infrastructure, security and systems
 * projects in the running at all.
 */
// Repo discovery is Hacker News only, deliberately.
//
// Exa was tried and dropped: with no date filter it returned an identical set
// on every run (measured 20/20 across back-to-back calls), so the same
// perennials resurfaced week after week, and it contributed almost none of the
// picks worth keeping. Star-ranking GitHub's own 7-day window was tried too and
// yields a noisy pool — real projects sitting next to `deploy-vercel` and
// capability-report repos. An HN front-page slot is a human vouching for
// something; a star count in a rolling window is not.

export interface NewsItem {
  title: string;
  url: string;
  why: string;
}

export interface TechNews {
  stories: NewsItem[];
  repos: { name: string; url: string; stars: number; why: string }[];
  local: NewsItem[];
  islamic: NewsItem[];
}

interface Candidate {
  id: number;
  section: Section;
  title: string;
  url: string;
  publishedDate?: string;
  excerpt?: string;
  /** Hacker News score, when the story was discussed there. */
  hnPoints?: number;
}

interface RepoCandidate {
  id: number;
  name: string;
  url: string;
  stars: number;
  language: string | null;
  description: string | null;
  hnPoints?: number;
}

/**
 * The model picks by `id` and never writes a URL. Everything the post links to
 * is looked up from the fetched candidates, so a confident hallucination can
 * cost us a bad blurb but never a fabricated link.
 */
const pickSchema = z.object({
  id: z.number().describe("id of the candidate"),
  why: z
    .string()
    .describe("One sentence on why this matters, for this audience"),
});

/**
 * Every section defaults to empty. The prompt tells the model that leaving a
 * section out is a valid answer, and it takes that literally by omitting the
 * key — so a required array turns the correct response into a
 * `NoObjectGeneratedError` and loses the whole roundup over a quiet week for
 * Singapore or Islamic tech. Observed in a real run. Same trap as `suggested`
 * in ai-profile.service.
 */
const curationSchema = z.object({
  stories: z
    .array(pickSchema)
    .default([])
    .describe("The 3-5 strongest global stories, best first. Empty if none are good."),
  repos: z
    .array(pickSchema)
    .default([])
    .describe("The 2-4 most interesting repos, best first. Empty if none are."),
  local: z
    .array(pickSchema)
    .default([])
    .describe("Up to 3 Singapore/SEA headlines, best first. Empty if none are good."),
  islamic: z
    .array(pickSchema)
    .default([])
    .describe("Up to 3 Muslim/Islamic tech headlines, best first. Empty if none are good."),
});

/** Exported for testing — the omitted-section case is easy to regress. */
export const curationSchemaForTest = curationSchema;

/** ISO date `days` ago, the granularity Exa filters on. */
function daysAgo(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
}

/** Host + path, so the same story found twice matches despite tracking params. */
function normaliseUrl(rawUrl: string): string | null {
  try {
    const url = new URL(rawUrl);
    return `${url.hostname.replace(/^www\./, "")}${url.pathname.replace(/\/$/, "")}`.toLowerCase();
  } catch {
    return null;
  }
}

// ── Hacker News ─────────────────────────────────────────────

interface HnStory {
  title: string;
  url: string;
  points: number;
  comments: number;
}

/**
 * The past week's front page, used three ways: as news candidates outright, as
 * the repo discovery pool, and as a boost for Exa stories that also landed
 * here. HN is free, needs no key, and its ranking is the same filter this
 * community would apply by hand.
 */
async function fetchHnStories(): Promise<HnStory[]> {
  const since = Math.floor(Date.now() / 1000) - 7 * 24 * 60 * 60;

  const batches = await Promise.all(
    ["story", "show_hn"].map(async (tag) => {
      const params = new URLSearchParams({
        tags: tag,
        numericFilters: `created_at_i>${since},points>${MIN_HN_POINTS}`,
        hitsPerPage: "100",
      });

      try {
        const res = await fetch(`${HN_SEARCH_URL}?${params}`, {
          headers: { "User-Agent": "msociety-bot/1.0 (+https://msociety.dev)" },
          signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        });
        if (!res.ok) {
          console.error("[tech-news] HN search failed:", res.status);
          return [];
        }

        const json = (await res.json()) as {
          hits?: {
            title?: string;
            url?: string;
            points?: number;
            num_comments?: number;
          }[];
        };

        return (json.hits ?? [])
          .filter(
            (h): h is typeof h & { title: string; url: string } =>
              !!h.title && !!h.url,
          )
          .map((h) => ({
            title: h.title,
            url: h.url,
            points: h.points ?? 0,
            comments: h.num_comments ?? 0,
          }));
      } catch (err) {
        console.error("[tech-news] HN search error:", err);
        return [];
      }
    }),
  );

  const seen = new Set<string>();
  return batches
    .flat()
    .filter((s) => {
      const key = normaliseUrl(s.url) ?? s.url;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => b.points - a.points);
}

// ── Exa ─────────────────────────────────────────────────────

interface ExaResult {
  title?: string;
  url?: string;
  publishedDate?: string;
  text?: string;
}

async function exaSearch(body: Record<string, unknown>): Promise<ExaResult[]> {
  if (!env.EXA_API_KEY) return [];

  try {
    const res = await fetch(EXA_SEARCH_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": env.EXA_API_KEY,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });

    if (!res.ok) {
      console.error("[tech-news] Exa search failed:", res.status);
      return [];
    }

    const json = (await res.json()) as { results?: ExaResult[] };
    return json.results ?? [];
  } catch (err) {
    console.error("[tech-news] Exa search error:", err);
    return [];
  }
}

async function fetchStories(
  hnPointsByUrl: Map<string, number>,
): Promise<Omit<Candidate, "id">[]> {
  const since = daysAgo(7);
  // Exa sometimes reports a publish date days in the future. Anything past
  // today is a bad date rather than a scoop, so it doesn't belong in a
  // "this week" roundup.
  const notFuture = Date.now() + 24 * 60 * 60 * 1000;

  const batches = await Promise.all(
    SEARCH_QUERIES.map(async ({ section, query }) => {
      const results = await exaSearch({
        query,
        type: "auto",
        category: "news",
        numResults: 8,
        startPublishedDate: since,
        contents: { text: { maxCharacters: EXCERPT_MAX } },
      });

      return results
        .filter((r): r is typeof r & { url: string } => !!r.url)
        .filter(
          (r) =>
            !r.publishedDate || new Date(r.publishedDate).getTime() <= notFuture,
        )
        .map((r) => {
          const key = normaliseUrl(r.url);
          return {
            section,
            title: r.title ?? "Untitled",
            url: r.url,
            publishedDate: r.publishedDate,
            excerpt: r.text ? clip(r.text, EXCERPT_MAX) : undefined,
            hnPoints: key ? hnPointsByUrl.get(key) : undefined,
          };
        });
    }),
  );

  return batches.flat();
}

// ── GitHub ──────────────────────────────────────────────────

/** First-level github.com paths that are site features, not accounts. */
const GITHUB_RESERVED_PATHS = new Set([
  "about", "apps", "collections", "enterprise", "explore", "features",
  "issues", "join", "login", "marketplace", "notifications", "orgs",
  "pricing", "pulls", "search", "settings", "sponsors", "topics", "trending",
]);

/**
 * `owner/repo` from a github.com URL, or null.
 *
 * Requires exactly two path segments, so an issue or blob link — which is a
 * story *about* a repo, not a project launch — doesn't become a repo pick.
 */
function parseRepoPath(rawUrl: string): string | null {
  try {
    const url = new URL(rawUrl);
    if (url.hostname !== "github.com" && url.hostname !== "www.github.com") {
      return null;
    }
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts.length !== 2) return null;
    const [owner, repo] = parts;
    if (!owner || !repo) return null;
    if (GITHUB_RESERVED_PATHS.has(owner.toLowerCase())) return null;
    return `${owner}/${repo.replace(/\.git$/, "")}`;
  } catch {
    return null;
  }
}

/**
 * Study material and link collections dressed as projects. These reliably farm
 * stars without being anything a working engineer would adopt, and no metric
 * separates them — their star and fork counts look healthy.
 */
const LOW_SIGNAL_REPO =
  /\b(awesome|cheat.?sheets?|roadmaps?|interview.?(prep|questions?)|tutorials?|bootcamps?|courses?|100.?days|study.?plan|learning.?(path|resources?)|(resources?|links?).?(list|collection)|collection of (links|resources))\b/i;

async function githubFetch(path: string): Promise<unknown | null> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (env.GITHUB_TOKEN) headers.Authorization = `Bearer ${env.GITHUB_TOKEN}`;

  try {
    const res = await fetch(`${GITHUB_API}${path}`, {
      headers,
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) {
      console.error("[tech-news] GitHub", path, "failed:", res.status);
      return null;
    }
    return await res.json();
  } catch (err) {
    console.error("[tech-news] GitHub", path, "error:", err);
    return null;
  }
}

const repoSchema = z.object({
  full_name: z.string(),
  html_url: z.string(),
  stargazers_count: z.number(),
  language: z.string().nullable(),
  description: z.string().nullable(),
  created_at: z.string(),
  fork: z.boolean(),
  archived: z.boolean(),
});

type Repo = Omit<RepoCandidate, "id">;

function keepRepo(repo: z.infer<typeof repoSchema>, oldestAllowed: Date): boolean {
  if (repo.fork || repo.archived) return false;
  if (repo.stargazers_count < MIN_REPO_STARS) return false;
  // No description means nobody can tell what it is from the post either.
  if (!repo.description?.trim()) return false;
  if (new Date(repo.created_at) < oldestAllowed) return false;
  return !LOW_SIGNAL_REPO.test(`${repo.full_name} ${repo.description}`);
}

/**
 * Repos that reached the Hacker News front page in the last week.
 *
 * HN only finds them; every number in the post comes from the GitHub API, so a
 * link someone posted can never put an invented star count in the roundup.
 *
 * An empty result is a fine outcome — the repos section simply doesn't render.
 * Padding it from a star-ranked pool is what produced the junk picks.
 */
async function discoverRepos(hnStories: HnStory[]): Promise<Repo[]> {
  const pointsByPath = new Map<string, number>();
  for (const story of hnStories) {
    const path = parseRepoPath(story.url);
    if (!path) continue;
    const key = path.toLowerCase();
    // Keep the highest-scoring submission when a repo was posted more than once.
    if ((pointsByPath.get(key) ?? -1) < story.points) {
      pointsByPath.set(key, story.points);
    }
  }

  const paths = [...pointsByPath.keys()].slice(0, MAX_REPO_ENRICHMENTS);
  if (paths.length === 0) return [];

  const oldestAllowed = new Date();
  oldestAllowed.setMonth(oldestAllowed.getMonth() - MAX_REPO_AGE_MONTHS);

  const enriched = await Promise.all(
    paths.map(async (path): Promise<Repo | null> => {
      const parsed = repoSchema.safeParse(await githubFetch(`/repos/${path}`));
      if (!parsed.success || !keepRepo(parsed.data, oldestAllowed)) return null;

      const repo = parsed.data;
      return {
        name: repo.full_name,
        url: repo.html_url,
        stars: repo.stargazers_count,
        language: repo.language,
        description: repo.description,
        hnPoints: pointsByPath.get(path) || undefined,
      };
    }),
  );

  return enriched
    .filter((r): r is Repo => r !== null)
    .sort((a, b) => (b.hnPoints ?? 0) - (a.hnPoints ?? 0));
}

// ── Curation ────────────────────────────────────────────────

function renderCandidates(items: Candidate[]): string {
  if (items.length === 0) return "(none found)";
  return items
    .map((s) => {
      const meta = [
        s.publishedDate ? s.publishedDate.slice(0, 10) : null,
        s.hnPoints ? `${s.hnPoints} points on Hacker News` : null,
      ]
        .filter(Boolean)
        .join(", ");
      return `[${s.id}] ${s.title}${meta ? ` (${meta})` : ""}\n${s.excerpt ?? "(no excerpt)"}`;
    })
    .join("\n\n");
}

const SGT_DAY = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Singapore",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** `YYYY-MM-DD` as it reads in Singapore — the cache rolls over at midnight SGT. */
export function sgtDayKey(at: Date = new Date()): string {
  return SGT_DAY.format(at);
}

/**
 * Memoises one value per Singapore calendar day.
 *
 * A roundup costs several searches, up to 14 GitHub calls and a Sonnet call, so
 * `/technews` run twice in a row should not pay for it twice — and shouldn't
 * return a *different* answer either, since the model reranks on every run.
 *
 * In-memory on purpose: a deploy dropping the cache costs one regeneration,
 * which is cheaper than the table and migration persisting it would need.
 *
 * Concurrent callers share one in-flight load, so spamming the command while
 * the first is still running doesn't fan out into parallel generations. A
 * rejected load is never cached, so a transient failure retries next time.
 */
export function dailyCache<T>(load: () => Promise<T>) {
  let cachedDay: string | null = null;
  let cachedValue: T | undefined;
  let inFlight: Promise<T> | null = null;
  let inFlightDay: string | null = null;

  return async function get(
    opts: { force?: boolean; now?: Date } = {},
  ): Promise<T> {
    const today = sgtDayKey(opts.now);

    if (!opts.force) {
      if (cachedDay === today) return cachedValue as T;
      if (inFlight && inFlightDay === today) return inFlight;
    }

    inFlightDay = today;
    inFlight = load()
      .then((value) => {
        cachedDay = today;
        cachedValue = value;
        return value;
      })
      .finally(() => {
        inFlight = null;
        inFlightDay = null;
      });

    return inFlight;
  };
}

export const techNewsService = {
  /**
   * Curates the week in tech for the community group, or returns `null` when
   * there's nothing worth posting — an empty roundup is worse than silence.
   */
  async generateWeeklyTechNews(): Promise<TechNews | null> {
    const hnStories = await fetchHnStories();

    const hnPointsByUrl = new Map<string, number>();
    for (const story of hnStories) {
      const key = normaliseUrl(story.url);
      if (key) hnPointsByUrl.set(key, story.points);
    }

    const [exaStories, rawRepos] = await Promise.all([
      fetchStories(hnPointsByUrl),
      discoverRepos(hnStories),
    ]);

    // HN stories that aren't repo links stand as news candidates on their own.
    const hnNews: Omit<Candidate, "id">[] = hnStories
      .filter((s) => !parseRepoPath(s.url))
      .slice(0, 15)
      .map((s) => ({
        section: "global" as const,
        title: s.title,
        url: s.url,
        hnPoints: s.points,
        excerpt: `Discussed on Hacker News: ${s.points} points, ${s.comments} comments.`,
      }));

    // HN first so its entry wins the dedupe and keeps its score.
    const seen = new Set<string>();
    const rawStories = [...hnNews, ...exaStories].filter((s) => {
      const key = normaliseUrl(s.url) ?? s.url;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    if (rawStories.length === 0 && rawRepos.length === 0) return null;

    const candidates: Candidate[] = rawStories.map((s, i) => ({ ...s, id: i }));
    const repos: RepoCandidate[] = rawRepos.map((r, i) => ({ ...r, id: i }));

    const bySection = (section: Section) =>
      candidates.filter((c) => c.section === section);

    const repoList = repos.length
      ? repos
          .map((r) => {
            const meta = [
              `${r.stars} stars`,
              r.language ?? "unknown language",
              r.hnPoints ? `${r.hnPoints} points on Hacker News` : null,
            ]
              .filter(Boolean)
              .join(", ");
            return `[${r.id}] ${r.name} — ${meta}\n${r.description ?? "(no description)"}`;
          })
          .join("\n\n")
      : "(none found)";

    const result = await aiService.generateObject(
      {
        model: aiService.models.smart,
        schema: curationSchema,
        prompt: `You curate a weekly tech roundup for MSOCIETY, a community of Muslim tech professionals in Singapore. They are working engineers, founders and builders — heavy on web, AI, infrastructure and startups. They read Hacker News. Assume they already know the obvious headlines.

Pick what is genuinely worth their attention. Favour substance over hype: real releases, shifts that change how people build, research with practical consequences, tools they might actually adopt. Drop press releases, funding-round noise, listicles, low-effort AI slop, and anything that is really an advertisement. If a candidate is weak, leave it out — a short roundup beats a padded one, and an empty section is a valid answer.

A high Hacker News score means working engineers already found it worth arguing about. Treat it as strong evidence, though a high score on a thin story still doesn't earn a slot.

For repositories, be actively sceptical. Reject:
- reimplementations, clones or "X from scratch" builds whose real value is a tutorial
- thin wrappers around an existing API or model
- anything whose pitch is a demo rather than a tool someone would depend on
- projects that are interesting only because AI is fashionable right now
Prefer things that solve a real problem, that a reader could plausibly install this month, and that aren't all from the same corner of the ecosystem. Variety across domains beats four takes on the same idea. If only one repo is genuinely good, return one.

Each "why" is one sentence, plain and concrete, written for a busy engineer. No hype words, no emojis, no markdown.

The two regional sections are short sidebars, not the main event: at most 3 each, and fewer when the material is thin. Never pad them to reach 3. Never reuse an item that already appears in another section.

GLOBAL TECH CANDIDATES:
${renderCandidates(bySection("global"))}

REPOSITORY CANDIDATES:
${repoList}

SINGAPORE / SEA CANDIDATES:
${renderCandidates(bySection("local"))}

MUSLIM / ISLAMIC TECH CANDIDATES:
${renderCandidates(bySection("islamic"))}`,
      },
      { caller: "tech-news", class: "background" },
    );

    // Widened to `unknown` by the tracking wrapper; re-parse to recover the type.
    const curated = curationSchema.parse(result.object);

    const byId = new Map(candidates.map((c) => [c.id, c]));
    const repoById = new Map(repos.map((r) => [r.id, r]));

    // A section's picks are drawn from that section's candidates only — the
    // model occasionally reaches across, and an id collides across sections.
    const resolve = (picks: { id: number; why: string }[], section: Section, cap: number) =>
      picks
        .flatMap(({ id, why }) => {
          const item = byId.get(id);
          return item && item.section === section
            ? [{ title: item.title, url: item.url, why }]
            : [];
        })
        .slice(0, cap);

    const picked: TechNews = {
      stories: resolve(curated.stories, "global", 5),
      local: resolve(curated.local, "local", 3),
      islamic: resolve(curated.islamic, "islamic", 3),
      repos: curated.repos
        .flatMap(({ id, why }) => {
          const r = repoById.get(id);
          return r ? [{ name: r.name, url: r.url, stars: r.stars, why }] : [];
        })
        .slice(0, 4),
    };

    const total =
      picked.stories.length +
      picked.repos.length +
      picked.local.length +
      picked.islamic.length;

    return total > 0 ? picked : null;
  },
};

/**
 * The day's roundup, generated at most once per Singapore day.
 *
 * Both the Monday broadcast and `/technews` go through this, so the command
 * echoes exactly what was posted to the group rather than a freshly reranked
 * variant of it. `force` skips the cache for an on-demand refresh.
 *
 * `null` is cached like any other answer — a day with nothing worth posting
 * shouldn't re-run the whole pipeline on every invocation.
 */
export const getWeeklyTechNews = dailyCache(() =>
  techNewsService.generateWeeklyTechNews(),
);

import { stepCountIs, tool } from "ai";
import { z } from "zod";
import type { ToolContext } from "../tools";
import {
  trackToolCalls,
  type SubagentActivity,
} from "../../lib/subagent-progress";
import { aiService } from "../../../services/ai.service";
import { clip } from "../../../lib/text";
import { htmlToMarkdown, pageToMarkdown } from "../../lib/html-to-markdown";
import { env } from "../../../env";

const EXA_SEARCH_URL = "https://api.exa.ai/search";
const HN_SEARCH_URL = "https://hn.algolia.com/api/v1/search";
const GITHUB_SEARCH_URL = "https://api.github.com/search/repositories";

/** Per-result text budget. Five results at this size fit comfortably in Haiku. */
const RESULT_TEXT_MAX = 1500;
/** Cap on a directly fetched page, which has no per-result budget to share. */
const PAGE_TEXT_MAX = 6000;

const FETCH_TIMEOUT_MS = 10_000;

interface ExaResult {
  title?: string;
  url?: string;
  publishedDate?: string;
  author?: string;
  text?: string;
}

export function createResearchTools(_ctx: ToolContext) {
  return {
    web_search: tool({
      description:
        "Search the live web for current information. Use for anything that changes over time or that you don't know: news, release notes, documentation, prices, events. Returns titles, URLs and excerpts.",
      inputSchema: z.object({
        query: z
          .string()
          .describe("What to search for, phrased as a natural-language query"),
        num_results: z
          .number()
          .min(1)
          .max(8)
          .optional()
          .default(5)
          .describe("How many results to return (default 5)"),
        include_domains: z
          .array(z.string())
          .optional()
          .describe("Restrict results to these domains, e.g. ['bun.sh']"),
      }),
      execute: async ({ query, num_results, include_domains }) => {
        if (!env.EXA_API_KEY) {
          return {
            error: "Web search is not configured on this deployment.",
          };
        }

        console.log("[research-agent:web_search]", query);

        const res = await fetch(EXA_SEARCH_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": env.EXA_API_KEY,
          },
          body: JSON.stringify({
            query,
            type: "auto",
            numResults: num_results ?? 5,
            ...(include_domains?.length
              ? { includeDomains: include_domains }
              : {}),
            contents: { text: { maxCharacters: RESULT_TEXT_MAX } },
          }),
          signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        });

        if (!res.ok) {
          const body = await res.text().catch(() => "");
          console.error(
            "[research-agent:web_search] failed:",
            res.status,
            body.slice(0, 200),
          );
          return { error: `Search failed with status ${res.status}` };
        }

        const json = (await res.json()) as { results?: ExaResult[] };
        const results = json.results ?? [];
        if (results.length === 0)
          return { results: [], note: "No results found." };

        return {
          results: results.map((r) => ({
            title: r.title ?? "Untitled",
            url: r.url,
            publishedDate: r.publishedDate,
            excerpt: r.text ? clip(r.text, RESULT_TEXT_MAX) : undefined,
          })),
        };
      },
    }),

    hacker_news_search: tool({
      description:
        "Search Hacker News for what working engineers actually said about something. Use for opinions, real-world experience reports, and whether a tool is worth adopting — the comments carry judgement a vendor page never will. Also the best way to find well-received new projects.",
      inputSchema: z.object({
        query: z
          .string()
          .describe("Keywords to search for, e.g. 'sqlite in production'"),
        kind: z
          .enum(["story", "comment", "show_hn"])
          .optional()
          .default("story")
          .describe(
            "story = submissions, comment = discussion text (best for opinions), show_hn = project launches",
          ),
        min_points: z
          .number()
          .optional()
          .describe(
            "Only results scoring above this. Defaults to 10 for stories, unset for comments.",
          ),
        days: z
          .number()
          .optional()
          .describe("Restrict to the last N days. Omit to search all time."),
        num_results: z.number().min(1).max(10).optional().default(5),
      }),
      execute: async ({ query, kind, min_points, days, num_results }) => {
        console.log("[research-agent:hacker_news_search]", kind, query);

        const filters: string[] = [];
        // Comment scores are mostly 0, so a points floor there hides everything.
        const points = min_points ?? (kind === "comment" ? undefined : 10);
        if (points !== undefined) filters.push(`points>${points}`);
        if (days !== undefined) {
          filters.push(
            `created_at_i>${Math.floor(Date.now() / 1000) - days * 86400}`,
          );
        }

        const params = new URLSearchParams({
          query,
          tags: kind,
          hitsPerPage: String(num_results ?? 5),
        });
        if (filters.length) params.set("numericFilters", filters.join(","));

        try {
          const res = await fetch(`${HN_SEARCH_URL}?${params}`, {
            headers: {
              "User-Agent": "msociety-bot/1.0 (+https://msociety.dev)",
            },
            signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
          });
          if (!res.ok)
            return { error: `Hacker News search failed (${res.status})` };

          const json = (await res.json()) as {
            hits?: {
              objectID?: string;
              title?: string;
              story_title?: string;
              url?: string;
              points?: number;
              num_comments?: number;
              author?: string;
              created_at?: string;
              comment_text?: string;
            }[];
          };

          const hits = json.hits ?? [];
          if (hits.length === 0)
            return { results: [], note: "No matching discussions." };

          return {
            results: hits.map((h) => ({
              title: h.title ?? h.story_title ?? "Untitled",
              // The discussion is usually the point; the linked article is extra.
              discussion: h.objectID
                ? `https://news.ycombinator.com/item?id=${h.objectID}`
                : undefined,
              url: h.url,
              points: h.points,
              comments: h.num_comments,
              author: h.author,
              date: h.created_at?.slice(0, 10),
              text: h.comment_text
                ? clip(htmlToMarkdown(h.comment_text), RESULT_TEXT_MAX)
                : undefined,
            })),
          };
        } catch (err) {
          const reason = err instanceof Error ? err.message : String(err);
          console.error("[research-agent:hacker_news_search] failed:", reason);
          return { error: `Hacker News search failed: ${reason}` };
        }
      },
    }),

    github_search_repos: tool({
      description:
        "Find public GitHub repositories by topic, language or popularity. Use when someone asks what libraries exist for a problem, what's new in an ecosystem, or how popular a project is. Returns real star counts and descriptions.",
      inputSchema: z.object({
        query: z.string().describe("Keywords, e.g. 'postgres migration tool'"),
        language: z
          .string()
          .optional()
          .describe("Restrict to a language, e.g. 'rust'"),
        min_stars: z
          .number()
          .optional()
          .describe("Only repos above this star count"),
        created_after: z
          .string()
          .optional()
          .describe(
            "ISO date (YYYY-MM-DD) — use to find recently created projects",
          ),
        sort: z
          .enum(["stars", "updated", "forks"])
          .optional()
          .default("stars")
          .describe(
            "Ranking. 'updated' surfaces actively maintained projects.",
          ),
        num_results: z.number().min(1).max(10).optional().default(5),
      }),
      execute: async ({
        query,
        language,
        min_stars,
        created_after,
        sort,
        num_results,
      }) => {
        const qualifiers = [
          query,
          language ? `language:${language}` : "",
          min_stars !== undefined ? `stars:>${min_stars}` : "",
          created_after ? `created:>${created_after}` : "",
        ]
          .filter(Boolean)
          .join(" ");

        console.log("[research-agent:github_search_repos]", qualifiers);

        const headers: Record<string, string> = {
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
        };
        if (env.GITHUB_TOKEN)
          headers.Authorization = `Bearer ${env.GITHUB_TOKEN}`;

        const url = `${GITHUB_SEARCH_URL}?q=${encodeURIComponent(qualifiers)}&sort=${sort ?? "stars"}&order=desc&per_page=${num_results ?? 5}`;

        try {
          const res = await fetch(url, {
            headers,
            signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
          });
          if (res.status === 403) {
            return {
              error:
                "GitHub rate limit reached. Try again shortly, or answer from search results instead.",
            };
          }
          if (!res.ok) return { error: `GitHub search failed (${res.status})` };

          const json = (await res.json()) as {
            total_count?: number;
            items?: {
              full_name: string;
              html_url: string;
              description: string | null;
              stargazers_count: number;
              language: string | null;
              created_at: string;
              pushed_at: string;
              archived: boolean;
            }[];
          };

          const items = json.items ?? [];
          if (items.length === 0)
            return { results: [], note: "No matching repositories." };

          return {
            totalMatches: json.total_count,
            results: items.map((r) => ({
              name: r.full_name,
              url: r.html_url,
              stars: r.stargazers_count,
              language: r.language,
              description: r.description,
              created: r.created_at.slice(0, 10),
              lastPush: r.pushed_at.slice(0, 10),
              archived: r.archived || undefined,
            })),
          };
        } catch (err) {
          const reason = err instanceof Error ? err.message : String(err);
          console.error("[research-agent:github_search_repos] failed:", reason);
          return { error: `GitHub search failed: ${reason}` };
        }
      },
    }),

    fetch_url: tool({
      description:
        "Fetch a specific web page and return its readable text. Use when someone shares a link, or to read a page found via web_search in full.",
      inputSchema: z.object({
        url: z.string().describe("The full URL to fetch, including https://"),
      }),
      execute: async ({ url }) => {
        console.log("[research-agent:fetch_url]", url);

        let parsed: URL;
        try {
          parsed = new URL(url);
        } catch {
          return { error: "That is not a valid URL." };
        }

        // Only public web protocols. Blocks file:// and similar, and keeps the
        // model from turning a chat message into a request to internal hosts.
        if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
          return { error: "Only http and https URLs can be fetched." };
        }

        try {
          const res = await fetch(parsed.toString(), {
            headers: {
              "User-Agent": "msociety-bot/1.0 (+https://msociety.dev)",
            },
            signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
            redirect: "follow",
          });

          if (!res.ok) {
            return { error: `Fetch failed with status ${res.status}` };
          }

          const contentType = res.headers.get("content-type") ?? "";
          if (!contentType.includes("html") && !contentType.includes("text")) {
            return { error: `Unsupported content type: ${contentType}` };
          }

          const body = await res.text();
          const text = contentType.includes("html")
            ? pageToMarkdown(body, res.url)
            : body.trim();

          return {
            url: res.url,
            contentType,
            text: clip(text, PAGE_TEXT_MAX),
            truncated: text.length > PAGE_TEXT_MAX,
          };
        } catch (err) {
          const reason = err instanceof Error ? err.message : String(err);
          console.error("[research-agent:fetch_url] failed:", reason);
          return { error: `Could not fetch that page: ${reason}` };
        }
      },
    }),
  };
}

/** Every tool this sub-agent can call. Drives the label map's exhaustiveness. */
export type ResearchToolName = keyof ReturnType<typeof createResearchTools>;

export function createResearchAgent(ctx: ToolContext) {
  const researchTools = createResearchTools(ctx);

  return async function runResearchAgent(
    query: string,
    activity?: SubagentActivity,
  ): Promise<string> {
    console.log("[research-agent] query:", query);

    const today = new Date().toLocaleDateString("en-SG", {
      timeZone: "Asia/Singapore",
    });

    const result = await aiService.generateText(
      {
        system: `You research questions using the live web for the MSOCIETY community bot. Today's date is ${today}.

Pick the tool that fits the question:
- web_search for facts, news, docs, anything current.
- hacker_news_search when the question is really "is this any good?" — opinions, war stories, whether a tool survives contact with production. Search comments for judgement, show_hn for new projects.
- github_search_repos for "what libraries exist for X", ecosystem surveys, or real popularity numbers.
- fetch_url when a result's excerpt isn't enough, or someone shares a link.

Search first, then fetch a page only when the excerpts don't answer the question.
Prefer primary sources (official docs, release notes, the project's own site) over aggregators.
Star counts and HN scores come from the tools — never estimate them yourself.

Answer in 2-4 sentences. Always cite the source URL you relied on.
If the results don't actually answer the question, say so plainly rather than guessing.
Never present a search excerpt as fact if the sources disagree — say what's uncertain.
Format for Telegram Markdown. Be concise: this is a chat reply, not a report.`,
        messages: [{ role: "user", content: query }],
        tools: trackToolCalls(researchTools, activity),
        stopWhen: stepCountIs(5),
        maxOutputTokens: 512,
      },
      {
        caller: "research-agent",
        tier: "fast",
        telegramUserId: ctx.senderTelegramId,
        chatId: ctx.chatId,
      },
    );

    console.log(
      "[research-agent] steps:",
      result.steps.length,
      "| response:",
      result.text?.slice(0, 120),
    );

    return result.text || "I couldn't find anything useful on that.";
  };
}

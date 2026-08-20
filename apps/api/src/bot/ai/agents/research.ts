import { stepCountIs, tool } from "ai";
import { z } from "zod";
import type { ToolContext } from "../tools";
import {
  trackToolCalls,
  type SubagentActivity,
} from "../../lib/subagent-progress";
import { aiService } from "../../../services/ai.service";
import { env } from "../../../env";

const EXA_SEARCH_URL = "https://api.exa.ai/search";

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

/**
 * Strips a HTML document down to readable text.
 *
 * Deliberately crude — the output feeds an LLM, not a renderer, so structure
 * matters less than dropping the script/style noise that would otherwise eat
 * the token budget.
 */
export function htmlToText(html: string): string {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
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
            ...(include_domains?.length ? { includeDomains: include_domains } : {}),
            contents: { text: { maxCharacters: RESULT_TEXT_MAX } },
          }),
          signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        });

        if (!res.ok) {
          const body = await res.text().catch(() => "");
          console.error("[research-agent:web_search] failed:", res.status, body.slice(0, 200));
          return { error: `Search failed with status ${res.status}` };
        }

        const json = (await res.json()) as { results?: ExaResult[] };
        const results = json.results ?? [];
        if (results.length === 0) return { results: [], note: "No results found." };

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
            headers: { "User-Agent": "msociety-bot/1.0 (+https://msociety.dev)" },
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
          const text = contentType.includes("html") ? htmlToText(body) : body.trim();

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
        model: aiService.models.fast,
        system: `You research questions using the live web for the MSOCIETY community bot. Today's date is ${today}.

Search first, then fetch a page only when the excerpts don't answer the question.
Prefer primary sources (official docs, release notes, the project's own site) over aggregators.

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

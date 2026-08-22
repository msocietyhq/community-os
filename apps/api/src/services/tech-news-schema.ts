import { z } from "zod";

/**
 * The curation model's output shape.
 *
 * Split out from tech-news.service so it can be tested without dragging in the
 * database, the AI client and `env` — which validates at import time and throws
 * when the test runner hasn't loaded apps/api/.env.
 */

/**
 * The model picks by `id` and never writes a URL. Everything the post links to
 * is looked up from the fetched candidates, so a confident hallucination can
 * cost us a bad blurb but never a fabricated link.
 */
export const pickSchema = z.object({
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
export const curationSchema = z.object({
  stories: z
    .array(pickSchema)
    .default([])
    .describe(
      "The 3-5 strongest global stories, best first. Empty if none are good.",
    ),
  repos: z
    .array(pickSchema)
    .default([])
    .describe("The 2-4 most interesting repos, best first. Empty if none are."),
  local: z
    .array(pickSchema)
    .default([])
    .describe(
      "Up to 3 Singapore/SEA headlines, best first. Empty if none are good.",
    ),
  islamic: z
    .array(pickSchema)
    .default([])
    .describe(
      "Up to 3 Muslim/Islamic tech headlines, best first. Empty if none are good.",
    ),
});

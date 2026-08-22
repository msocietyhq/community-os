import { z } from "zod";
import { aiSuggestedSchema } from "@community-os/shared/validators";

/**
 * The AI profile generator's output shape, and the repair step it needs.
 *
 * Split out from ai-profile.service so it can be tested without dragging in the
 * database, the AI client and `env` — which validates at import time and throws
 * when the test runner hasn't loaded apps/api/.env. Same reasoning as the
 * advisor-access / advisor-gate and chime-in / chime-in-judge pairs: the
 * decision is pure, the I/O lives next door.
 */

/**
 * Undoes the model collapsing its entire answer into one stringified field.
 *
 * Seen in production: `{"suggested": "{\"summary\": …, \"skills\": […]}"}` —
 * valid JSON, wrong shape. `generateObject` validates before it returns, so
 * this throws `NoObjectGeneratedError` and neither `withRetry` nor the
 * `looksLikeSerialisedJson` guard ever sees it. The member is then retried on
 * every boot forever, because failures aren't stamped.
 *
 * The content is intact in these responses — only the nesting is wrong — so
 * unwrapping recovers a real profile instead of discarding it. Runs as a
 * preprocess step, which the SDK applies during its own validation; the
 * generated JSON Schema is unaffected.
 */
export function unwrapCollapsedProfile(value: unknown): unknown {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return value;
  }
  const outer = value as Record<string, unknown>;

  // The payload has been seen stringified under either key.
  for (const key of ["suggested", "summary"] as const) {
    const raw = outer[key];
    if (typeof raw !== "string" || !raw.trim().startsWith("{")) continue;

    let inner: unknown;
    try {
      inner = JSON.parse(raw);
    } catch {
      continue;
    }
    if (typeof inner !== "object" || inner === null || Array.isArray(inner)) {
      continue;
    }

    // Whatever the outer object still holds legitimately wins over the blob.
    const { summary: innerSummary, ...innerRest } = inner as Record<
      string,
      unknown
    >;
    const outerSummary = key === "summary" ? undefined : outer.summary;
    const outerSuggested = key === "suggested" ? undefined : outer.suggested;

    return {
      summary: typeof outerSummary === "string" ? outerSummary : innerSummary,
      suggested: {
        ...(typeof outerSuggested === "object" && outerSuggested !== null
          ? outerSuggested
          : {}),
        ...innerRest,
      },
    };
  }

  return value;
}

export const generationSchema = z.preprocess(
  unwrapCollapsedProfile,
  z.object({
    summary: z
      .string()
      .describe(
        "2-4 sentences describing this person's work, expertise and current " +
          "interests. Matched against questions like 'who knows about X'. " +
          "Read only by the AI, never shown to anyone. Empty when the evidence " +
          "is too thin to say anything useful.",
      ),
    // Defaulted: the model omits the key when there's nothing to suggest, and a
    // hard requirement turns that correct answer into a NoObjectGeneratedError.
    suggested: aiSuggestedSchema.default({}).describe(
      "Candidate profile field values. Omit entirely when nothing is supported.",
    ),
  }),
);

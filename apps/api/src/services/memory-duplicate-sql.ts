import { sql } from "drizzle-orm";
import { botMemories } from "../db/schema/bot";

/**
 * Cosine floor above which a new fact is treated as a restatement of one
 * already held, and supersedes it.
 *
 * Measured against the corpus: pairs between 0.80 and 0.85 are overwhelmingly
 * distinct facts that happen to share vocabulary — "Mud expressed interest in
 * attending an event but cannot go" against "Mud is bringing snacks for an
 * event" scores 0.801. Lowering this to catch more restatements would silently
 * delete real information, so it stays where it is.
 */
export const DUPLICATE_SIMILARITY = 0.85;

/** The same floor for a pair the model gave different categories. */
export const CROSS_CATEGORY_DUPLICATE_SIMILARITY = 0.92;

/**
 * Cosine-vs-threshold predicate used by saveMemory's duplicate check.
 *
 * Drizzle binds JS numbers as untyped params. PostgreSQL types a CASE of
 * untyped params as text, so the branches must be `::float8` — otherwise
 * `1 - (embedding <=> vector) > CASE ...` is `double precision > text`.
 */
export function duplicateSimilaritySql(embedding: number[], category: string) {
  const vectorLiteral = `[${embedding.join(",")}]`;
  return sql`1 - (${botMemories.embedding} <=> ${vectorLiteral}::vector) >
        CASE WHEN ${botMemories.category} = ${category}
             THEN ${DUPLICATE_SIMILARITY}::float8
             ELSE ${CROSS_CATEGORY_DUPLICATE_SIMILARITY}::float8 END`;
}

import { type eq, ilike, or, sql } from "drizzle-orm";
import { user } from "../db/schema/auth";
import { members } from "../db/schema/members";
import type { MemberListQuery } from "@community-os/shared/validators";

/**
 * Builds `ARRAY[...]` SQL for use with `ANY(...)`.
 *
 * Interpolating a JS array directly into a `sql` template expands it to a
 * bare comma list (`($1, $2)`, meant for `IN (...)`), which isn't valid
 * inside `ANY(...)` — that needs an actual array expression.
 */
function sqlTextArray(values: string[]) {
  return sql`ARRAY[${sql.join(
    values.map((v) => sql`${v}`),
    sql`, `,
  )}]::text[]`;
}

/**
 * Builds the WHERE conditions for `q`/`skills`/`interests` on `members.list`.
 *
 * Lives in its own module (no `db`/`env`/`bot` imports) so it can be
 * unit-tested — compiled SQL, and against a live Postgres — without those
 * singletons needing real secrets or a running server.
 */
export function buildMemberSearchConditions(
  query: Pick<MemberListQuery, "q" | "skills" | "interests">,
): ReturnType<typeof eq>[] {
  const conditions: ReturnType<typeof eq>[] = [];

  if (query.q) {
    const pattern = `%${query.q}%`;
    conditions.push(
      or(
        // lakebase_bm25 over the generated search_vector column (bio,
        // github_handle, current_company, current_title, education,
        // skills, interests — see drizzle/0030_lakebase_text_migration.sql)
        sql`"search_vector" @@ websearch_to_tsquery('english', ${query.q})`,
        // ILIKE for user table fields (separate table, not in the index)
        ilike(user.name, pattern),
        ilike(user.telegramUsername, pattern),
      )!,
    );
  }

  const skillsArr = query.skills
    ?.split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (skillsArr?.length) {
    // skills/interests are structured tags, not prose, so filter with
    // array containment rather than BM25 relevance ranking.
    const patterns = skillsArr.map((s) => `%${s}%`);
    conditions.push(
      sql`EXISTS (SELECT 1 FROM unnest(${members.skills}) AS skill WHERE skill ILIKE ANY(${sqlTextArray(patterns)}))`,
    );
  }

  const interestsArr = query.interests
    ?.split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (interestsArr?.length) {
    const patterns = interestsArr.map((s) => `%${s}%`);
    conditions.push(
      sql`EXISTS (SELECT 1 FROM unnest(${members.interests}) AS interest WHERE interest ILIKE ANY(${sqlTextArray(patterns)}))`,
    );
  }

  return conditions;
}

import { describe, expect, test } from "bun:test";
import { and, eq } from "drizzle-orm";
import { QueryBuilder } from "drizzle-orm/pg-core";
import postgres from "postgres";
import { user } from "../db/schema/auth";
import { members } from "../db/schema/members";
import { buildMemberSearchConditions } from "./members-search";

function compile(query: Parameters<typeof buildMemberSearchConditions>[0]) {
  const qb = new QueryBuilder();
  const conditions = buildMemberSearchConditions(query);
  const where = conditions.length ? and(...conditions) : undefined;
  return qb.select({ id: members.id }).from(members).where(where).toSQL();
}

describe("buildMemberSearchConditions", () => {
  test("q matches the generated search_vector column, not ParadeDB's @@@", () => {
    const { sql, params } = compile({ q: "founder" });
    expect(sql).toContain('"search_vector" @@ websearch_to_tsquery');
    expect(sql).not.toContain("@@@");
    expect(params).toContain("founder");
  });

  test("q also falls back to ILIKE on the joined user table", () => {
    const { sql, params } = compile({ q: "alice" });
    expect(sql).toContain('"user"."name" ilike');
    expect(sql).toContain('"user"."telegram_username" ilike');
    expect(params).toContain("%alice%");
  });

  test("skills filters by array containment (unnest + ILIKE ANY), not BM25", () => {
    const { sql, params } = compile({ skills: "React, Vue" });
    expect(sql).toContain('unnest("members"."skills")');
    expect(sql).toMatch(/ILIKE ANY\(ARRAY\[\$\d+, \$\d+\]::text\[\]\)/);
    expect(sql).not.toContain("@@@");
    expect(params).toEqual(["%React%", "%Vue%"]);
  });

  test("interests compiles the same shape as skills", () => {
    const { sql, params } = compile({ interests: "music" });
    expect(sql).toContain('unnest("members"."interests")');
    expect(params).toEqual(["%music%"]);
  });

  test("blank/whitespace-only skills and interests are dropped, not turned into an always-empty ANY([])", () => {
    expect(buildMemberSearchConditions({ skills: " , ," })).toHaveLength(0);
    expect(buildMemberSearchConditions({ interests: "" })).toHaveLength(0);
  });

  test("no params produce no conditions", () => {
    expect(buildMemberSearchConditions({})).toHaveLength(0);
  });
});

describe("member search against a live Postgres tsvector column", () => {
  test("q/skills/interests match the way the migration's search_vector column will", async () => {
    const url =
      process.env.DATABASE_URL ??
      "postgresql://postgres:postgres@127.0.0.1:5432/community_os";
    const client = postgres(url, { max: 1, connect_timeout: 3 });

    try {
      await client`SELECT 1`;
    } catch (err) {
      await client.end().catch(() => undefined);
      if (!process.env.DATABASE_URL) {
        console.warn(
          "skipping live postgres check: no DATABASE_URL and local postgres unavailable",
        );
        return;
      }
      throw err;
    }

    try {
      // Mirrors drizzle/0030_lakebase_text_migration.sql's search_vector
      // column and its immutable array-to-text helper, minus `USING
      // lakebase_bm25` — a Neon-only index type not available on local
      // Postgres. The `@@` match predicate itself is native Postgres and
      // behaves identically with or without that index; only ranking speed
      // depends on it, and this service does not rank by score.
      await client`
        CREATE TEMP TABLE "user" (
          id text PRIMARY KEY,
          name text NOT NULL,
          telegram_username text
        )
      `;
      await client`
        CREATE TEMP TABLE members (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id text NOT NULL,
          bio text,
          github_handle text,
          current_company text,
          current_title text,
          education text,
          skills text[],
          interests text[]
        )
      `;
      await client`
        CREATE OR REPLACE FUNCTION members_array_to_text(arr text[]) RETURNS text AS $$
          SELECT array_to_string(arr, ' ')
        $$ LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE
      `;
      await client`
        ALTER TABLE members ADD COLUMN search_vector tsvector GENERATED ALWAYS AS (
          to_tsvector(
            'english',
            coalesce(bio, '') || ' ' ||
            coalesce(github_handle, '') || ' ' ||
            coalesce(current_company, '') || ' ' ||
            coalesce(current_title, '') || ' ' ||
            coalesce(education, '') || ' ' ||
            coalesce(members_array_to_text(skills), '') || ' ' ||
            coalesce(members_array_to_text(interests), '')
          )
        ) STORED
      `;

      await client`
        INSERT INTO "user" (id, name, telegram_username)
        VALUES ('u1', 'Alice Tan', 'alicetan'), ('u2', 'Bob Lee', 'boblee')
      `;
      await client`
        INSERT INTO members (user_id, bio, current_title, current_company, skills, interests)
        VALUES
          ('u1', 'Building fintech products for the unbanked', 'Software Engineer', 'Stripe', ARRAY['React','TypeScript'], ARRAY['music','hiking']),
          ('u2', 'Community organizer and researcher', 'Research Lead', 'NUS', ARRAY['Python'], ARRAY['policy'])
      `;

      const qb = new QueryBuilder();
      async function run(
        query: Parameters<typeof buildMemberSearchConditions>[0],
      ) {
        const conditions = buildMemberSearchConditions(query);
        const where = conditions.length ? and(...conditions) : undefined;
        const { sql: text, params } = qb
          .select({ id: members.id })
          .from(members)
          .innerJoin(user, eq(members.userId, user.id))
          .where(where)
          .toSQL();
        return client.unsafe(text, params as (string | number)[]);
      }

      expect(await run({ q: "fintech" })).toHaveLength(1);
      expect(await run({ q: "Stripe engineer" })).toHaveLength(1);
      expect(await run({ q: "nonexistent" })).toHaveLength(0);
      expect(await run({ skills: "react" })).toHaveLength(1);
      expect(await run({ skills: "python" })).toHaveLength(1);
      expect(await run({ skills: "vue" })).toHaveLength(0);
      expect(await run({ skills: "react,python" })).toHaveLength(2);
      expect(await run({ interests: "hiking,policy" })).toHaveLength(2);
      expect(await run({ interests: "nope" })).toHaveLength(0);
    } finally {
      await client.end();
    }
  });
});

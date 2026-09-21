-- Custom SQL migration file, put your code below! --

-- Migrate member search from ParadeDB (pg_search) to Neon's lakebase_text.
--
-- pg_search is deprecated by Neon: new installs blocked since 2026-03-19,
-- existing installs removed 2026-09-21 (today). lakebase_text is the
-- replacement — it indexes a tsvector you build yourself (here, a generated
-- STORED column) via the lakebase_bm25 index type, queried with native
-- Postgres `@@`/tsquery instead of ParadeDB's `@@@`. See issue #57.
--
-- lakebase_text must be enabled on the Neon project before this migration
-- runs (one-time: add it to preloaded_libraries via the Neon API, restart
-- the compute, per https://neon.com/docs/extensions/lakebase-text) — this
-- could not be confirmed from this environment for our specific project.

CREATE EXTENSION IF NOT EXISTS lakebase_text;
--> statement-breakpoint
-- array_to_string() is STABLE, not IMMUTABLE (Postgres won't say why beyond
-- "depends on anyarray"), so it can't be used directly inside a generated
-- column expression. Wrap it for a fixed text[] input, which has no such
-- dependency, so we can legitimately declare the wrapper IMMUTABLE.
CREATE OR REPLACE FUNCTION members_array_to_text(arr text[]) RETURNS text AS $$
  SELECT array_to_string(arr, ' ')
$$ LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE;
--> statement-breakpoint
ALTER TABLE "members" ADD COLUMN "search_vector" tsvector GENERATED ALWAYS AS (
  to_tsvector(
    'english',
    coalesce("bio", '') || ' ' ||
    coalesce("github_handle", '') || ' ' ||
    coalesce("current_company", '') || ' ' ||
    coalesce("current_title", '') || ' ' ||
    coalesce("education", '') || ' ' ||
    coalesce(members_array_to_text("skills"), '') || ' ' ||
    coalesce(members_array_to_text("interests"), '')
  )
) STORED;
--> statement-breakpoint
DROP INDEX IF EXISTS "members_search_idx";
--> statement-breakpoint
CREATE INDEX "members_search_idx" ON "members" USING lakebase_bm25 ("search_vector");
--> statement-breakpoint
DROP EXTENSION IF EXISTS pg_search;

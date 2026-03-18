-- Custom SQL migration file, put your code below! --
CREATE EXTENSION IF NOT EXISTS pg_search;
--> statement-breakpoint
CREATE INDEX members_search_idx ON members
USING bm25 (
  id,
  bio,
  github_handle,
  current_company,
  current_title,
  education,
  skills,
  interests
)
WITH (key_field = 'id');
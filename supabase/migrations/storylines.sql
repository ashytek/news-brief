-- Storylines: one developing news event, many reports (catch-up view,
-- phase 2 — see SPEC.md). The pipeline groups stories into storylines and
-- writes a recap; the web app shows them in the catch-up view (phase 3).
--
-- Run AFTER stories_short.sql. Safe to re-run.
-- The pipeline is fail-soft without this migration: it detects the missing
-- table/column, skips storylines and prints a hint, so merging the pipeline
-- change to main before running this costs nothing and breaks nothing.
--
-- News categories only (india_global, tech_ai); prophetic never forms one.
-- A story belongs to at most one storyline (stories.storyline_id).
--
-- recap shape:
--   { "so_far": [ { "date": "2026-09-30", "text": "…" }, … ],
--     "latest": { "date": "2026-10-02", "text": "…" } }
-- Built only once a storyline has 3+ reports. recap_story_count is the
-- story_count the recap was built from: the pipeline refreshes a recap
-- whenever story_count has moved on from it (so a failed refresh heals itself).
--
-- Do NOT reuse the removed `clusters` table or `cluster_id` columns
-- (removed July 2026 — see CLAUDE.md "Feature 3").

CREATE TABLE IF NOT EXISTS storylines (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category          text NOT NULL,
  title             text NOT NULL,
  recap             jsonb,
  story_count       int  NOT NULL DEFAULT 0,
  recap_story_count int  NOT NULL DEFAULT 0,
  first_report_at   timestamptz,
  last_report_at    timestamptz,
  recap_updated_at  timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now()
);

-- "Active" storylines (last report within 7 days) are found by this index;
-- there is no cleanup job — inactive ones are simply filtered by date.
CREATE INDEX IF NOT EXISTS storylines_last_report_at_idx
  ON storylines (last_report_at DESC);

-- Written by the pipeline (service role bypasses RLS); the signed-in user
-- only reads — same pattern as stories in rls_core_tables.sql.
ALTER TABLE storylines ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can read storylines" ON storylines;
CREATE POLICY "Authenticated users can read storylines" ON storylines
  FOR SELECT TO authenticated USING (true);

-- ON DELETE SET NULL so deleting a storyline (e.g. to redo the backfill)
-- just detaches its stories instead of failing.
ALTER TABLE stories
  ADD COLUMN IF NOT EXISTS storyline_id uuid REFERENCES storylines(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS stories_storyline_id_idx
  ON stories (storyline_id) WHERE storyline_id IS NOT NULL;

-- Shortlist for storyline assignment: the stories in the same category from
-- the last p_since.. that are most similar (cosine) to a new story, best first.
-- Done server-side on purpose: pulling the 7-day embedding pool into the
-- pipeline would be ~10 MB per cron run (~1 GB/month of the free-tier egress).
-- 3072 dims is too wide for ivfflat/hnsw, but a 7-day window is ~200 rows, so
-- the sequential scan is fine.
-- (p_exclude_id is an addition to the SPEC.md signature: the new story is
-- already embedded, so without it the story would match itself.)
CREATE OR REPLACE FUNCTION match_recent_stories(
  query_embedding vector(3072),
  p_category      text,
  p_since         timestamptz,
  p_min_sim       float8,
  p_limit         int,
  p_exclude_id    uuid DEFAULT NULL
)
RETURNS TABLE (
  id           uuid,
  storyline_id uuid,
  headline     text,
  similarity   float8
)
LANGUAGE sql STABLE AS $$
  SELECT s.id,
         s.storyline_id,
         s.headline,
         (1 - (s.embedding <=> query_embedding))::float8 AS similarity
  FROM stories s
  WHERE s.category = p_category
    AND s.created_at >= p_since
    AND s.embedding IS NOT NULL
    AND (p_exclude_id IS NULL OR s.id <> p_exclude_id)
    AND (1 - (s.embedding <=> query_embedding)) >= p_min_sim
  ORDER BY s.embedding <=> query_embedding
  LIMIT p_limit;
$$;

-- Same hygiene as the ranking functions: nothing for anon.
REVOKE EXECUTE ON FUNCTION match_recent_stories(vector, text, timestamptz, float8, int, uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION match_recent_stories(vector, text, timestamptz, float8, int, uuid)
  TO authenticated, service_role;

-- Make PostgREST see the new table, column and function straight away.
NOTIFY pgrst, 'reload schema';

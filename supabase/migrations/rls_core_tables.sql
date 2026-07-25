-- RLS for the core tables that were created directly in the Supabase
-- dashboard and never had policies: stories, videos, clusters, sources,
-- read_items, engagement, muted_topics, pipeline_runs, topic_keywords.
--
-- Access pattern (confirmed against app + pipeline code, July 2026):
--   - The Next.js app always hits Postgres as `authenticated` (every page
--     requires a session; there is no unauthenticated read path) or via
--     the service-role key from the Python pipeline, which bypasses RLS
--     entirely regardless of policy. So these policies only need to cover
--     `authenticated` — no `anon` policies are needed or intended.
--   - stories / videos / clusters / pipeline_runs: no user_id column,
--     read-only from the browser, written only by the pipeline
--     (service role) — so authenticated gets SELECT only.
--   - sources: read-only from most pages, but /sources lets the signed-in
--     user add a new source — authenticated gets SELECT + INSERT.
--   - read_items / engagement / muted_topics: have user_id, always
--     scoped by it in app code — same auth.uid() = user_id pattern
--     already used for source_weights/topic_weights in ranking_weights.sql.

-- ── stories ───────────────────────────────────────────────────────────────
ALTER TABLE stories ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can read stories" ON stories;
CREATE POLICY "Authenticated users can read stories" ON stories
  FOR SELECT TO authenticated USING (true);

-- ── videos ────────────────────────────────────────────────────────────────
-- Never queried standalone client-side, but PostgREST embeds (STORY_SELECT /
-- CLUSTER_SELECT join in videos(...)) need read access on the embedded table.
ALTER TABLE videos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can read videos" ON videos;
CREATE POLICY "Authenticated users can read videos" ON videos
  FOR SELECT TO authenticated USING (true);

-- ── clusters ──────────────────────────────────────────────────────────────
ALTER TABLE clusters ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can read clusters" ON clusters;
CREATE POLICY "Authenticated users can read clusters" ON clusters
  FOR SELECT TO authenticated USING (true);

-- ── sources ───────────────────────────────────────────────────────────────
ALTER TABLE sources ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can read sources" ON sources;
CREATE POLICY "Authenticated users can read sources" ON sources
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Authenticated users can add sources" ON sources;
CREATE POLICY "Authenticated users can add sources" ON sources
  FOR INSERT TO authenticated WITH CHECK (true);

-- ── read_items ────────────────────────────────────────────────────────────
ALTER TABLE read_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage own read items" ON read_items;
CREATE POLICY "Users manage own read items" ON read_items
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ── engagement ────────────────────────────────────────────────────────────
ALTER TABLE engagement ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage own engagement" ON engagement;
CREATE POLICY "Users manage own engagement" ON engagement
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ── muted_topics ──────────────────────────────────────────────────────────
ALTER TABLE muted_topics ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage own muted topics" ON muted_topics;
CREATE POLICY "Users manage own muted topics" ON muted_topics
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ── pipeline_runs ─────────────────────────────────────────────────────────
-- Operational data, no user scoping — only the pipeline health indicator
-- and /sources recent-runs list read it; only the pipeline (service role)
-- ever writes it.
ALTER TABLE pipeline_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can read pipeline runs" ON pipeline_runs;
CREATE POLICY "Authenticated users can read pipeline runs" ON pipeline_runs
  FOR SELECT TO authenticated USING (true);

-- ── topic_keywords ────────────────────────────────────────────────────────
-- No user_id — global watchlist, not per-user. Full CRUD from the browser
-- (TopicsPanel.tsx lets the signed-in user add/pause/delete keywords);
-- pipeline/db.py:get_topic_keywords() reads it via the service role, which
-- bypasses RLS regardless.
ALTER TABLE topic_keywords ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can manage topic keywords" ON topic_keywords;
CREATE POLICY "Authenticated users can manage topic keywords" ON topic_keywords
  FOR ALL TO authenticated
  USING (true)
  WITH CHECK (true);

-- Save for later (roadmap session 8, F058): stories you keep aside so "Mark all read"
-- and a busy day can't sweep them away. One row per user and story; the Archive's
-- "Saved" view lists them newest saved first.
--
-- Run this in the Supabase SQL editor. The web app works without it (the Save buttons
-- simply don't appear until the table exists), so it can be run before or after the deploy.
--
-- Stories are never deleted (only old transcripts are archived), so ON DELETE CASCADE on the
-- story is only housekeeping; deleting the user removes their saves.
CREATE TABLE IF NOT EXISTS saved_items (
  user_id   uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  story_id  uuid        NOT NULL REFERENCES stories(id)    ON DELETE CASCADE,
  saved_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, story_id)
);

-- The Saved list: this user's saves, newest first.
CREATE INDEX IF NOT EXISTS saved_items_user_saved_at ON saved_items (user_id, saved_at DESC);

-- Same pattern as read_items / engagement / muted_topics (rls_core_tables.sql):
-- the browser only ever touches its own rows.
ALTER TABLE saved_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage own saved items" ON saved_items;
CREATE POLICY "Users manage own saved items" ON saved_items
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Make PostgREST see the new table (and its link to stories, for the Saved list) straight away.
NOTIFY pgrst, 'reload schema';

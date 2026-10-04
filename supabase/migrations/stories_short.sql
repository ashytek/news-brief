-- Short card version of each story, shown by default in place of the long
-- overview + sections (catch-up view, phase 1 — see SPEC.md).
-- Shape: { "lead": text, "key_points": [text, ...] }, ~120 words in total.
-- Nullable on purpose: stories not yet backfilled fall back to `summary` in
-- the UI, and the pipeline saves a story without it if the column is absent.
--
-- Run this BEFORE deploying the web app (its story queries select `short`)
-- and before merging the pipeline change to main.
-- No RLS change needed: the existing per-row policy covers the new column.
ALTER TABLE stories ADD COLUMN IF NOT EXISTS short jsonb;

-- Make PostgREST see the new column straight away.
NOTIFY pgrst, 'reload schema';

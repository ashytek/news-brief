-- Distinguishes a scheduled cron run from a manual trigger (via the
-- app's "Run now" button — see app/api/pipeline/trigger/route.ts). Needed
-- so a scheduled run can check "did a manual trigger already cover this
-- window?" and skip redundant, billed work if so (see run_pipeline.py's
-- skip check at the top of run_once()).
ALTER TABLE pipeline_runs ADD COLUMN IF NOT EXISTS trigger_source text DEFAULT 'schedule';

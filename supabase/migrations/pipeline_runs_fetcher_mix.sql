-- run_pipeline.py already writes fetcher_mix (see pipeline/run_pipeline.py
-- ~line 419-425) but swallows the error until this column exists, so the
-- per-run transcript source mix isn't persisted historically yet.
ALTER TABLE pipeline_runs ADD COLUMN IF NOT EXISTS fetcher_mix jsonb;

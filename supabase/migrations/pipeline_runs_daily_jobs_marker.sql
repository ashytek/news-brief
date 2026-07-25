-- The "run daily jobs at most once per ~24h" gate used to be a local file
-- (.last_daily_jobs) next to the pipeline script. That never persists on
-- GitHub Actions — every run gets a fresh checkout — so daily jobs (weight
-- updates, archival, stale-failure expiry) were silently running on all 4
-- scheduled runs/day instead of 1, roughly quadrupling the engagement
-- weight adjustment rate. Track the last run instead, in the database the
-- pipeline already writes to on every run.
ALTER TABLE pipeline_runs ADD COLUMN IF NOT EXISTS daily_jobs_ran_at timestamptz;

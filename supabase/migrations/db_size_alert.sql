-- Read-only helper so the pipeline can watch total DB size against the
-- Supabase free-tier 500MB cap. stories.embedding (vector(3072), ~12KB/row)
-- is the fastest-growing column with no pruning in place — this is an
-- early-warning alert, not a size-reduction fix (no rows are deleted).
CREATE OR REPLACE FUNCTION get_database_size_mb()
RETURNS float
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT pg_database_size(current_database()) / 1024.0 / 1024.0;
$$;

-- SECURITY DEFINER functions grant EXECUTE to PUBLIC by default — only the
-- pipeline (service role) needs this, and total DB size is otherwise a
-- trivial info leak to anyone holding the public anon key.
REVOKE EXECUTE ON FUNCTION get_database_size_mb() FROM PUBLIC;

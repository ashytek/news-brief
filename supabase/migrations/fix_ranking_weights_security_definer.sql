-- adjust_source_weight / adjust_topic_weight (see ranking_weights.sql) are
-- SECURITY DEFINER and take p_user_id straight from the caller without
-- checking it matches the authenticated session. Any signed-in user could
-- currently call these RPCs with someone else's user_id and nudge their
-- source/topic weights. App code always passes the caller's own userId
-- (ReaderClient.tsx), so this guard changes no legitimate behaviour.
--
-- The check is skipped only for the service role (auth.role() = 'service_role') —
-- adjust_topic_weight is also called nightly by pipeline/update_weights.py
-- via the service-role key and must still be able to write any user's weights.
-- Both anon and service_role have auth.uid() = NULL, so checking auth.uid()
-- alone (an earlier version of this fix) let the anon role through too.

CREATE OR REPLACE FUNCTION adjust_source_weight(
  p_user_id   uuid,
  p_source_id uuid,
  p_delta     float
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_weight float;
BEGIN
  -- auth.uid() is NULL for BOTH the anon role and the service role, so
  -- "IS NOT NULL" alone doesn't distinguish them — anon callers slipped
  -- through unchecked. auth.role() does distinguish: only service_role
  -- (the pipeline) is exempt from matching p_user_id to the session.
  IF auth.role() <> 'service_role' AND (auth.uid() IS NULL OR p_user_id <> auth.uid()) THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  SELECT weight INTO v_weight
  FROM source_weights
  WHERE user_id = p_user_id AND source_id = p_source_id;

  IF FOUND THEN
    UPDATE source_weights
    SET weight     = LEAST(1.5, GREATEST(0.5, v_weight + p_delta)),
        updated_at = now()
    WHERE user_id = p_user_id AND source_id = p_source_id;
  ELSE
    BEGIN
      INSERT INTO source_weights (user_id, source_id, weight, updated_at)
      VALUES (p_user_id, p_source_id, LEAST(1.5, GREATEST(0.5, 1.0 + p_delta)), now());
    EXCEPTION WHEN unique_violation THEN
      UPDATE source_weights
      SET weight     = LEAST(1.5, GREATEST(0.5, weight + p_delta)),
          updated_at = now()
      WHERE user_id = p_user_id AND source_id = p_source_id;
    END;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION adjust_topic_weight(
  p_user_id uuid,
  p_kw      text,
  p_delta   float
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_weight float;
BEGIN
  -- auth.uid() is NULL for BOTH the anon role and the service role, so
  -- "IS NOT NULL" alone doesn't distinguish them — anon callers slipped
  -- through unchecked. auth.role() does distinguish: only service_role
  -- (the pipeline) is exempt from matching p_user_id to the session.
  IF auth.role() <> 'service_role' AND (auth.uid() IS NULL OR p_user_id <> auth.uid()) THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  SELECT weight INTO v_weight
  FROM topic_weights
  WHERE user_id = p_user_id AND kw = p_kw;

  IF FOUND THEN
    UPDATE topic_weights
    SET weight     = LEAST(2.0, GREATEST(0.3, v_weight + p_delta)),
        updated_at = now()
    WHERE user_id = p_user_id AND kw = p_kw;
  ELSE
    BEGIN
      INSERT INTO topic_weights (user_id, kw, weight, updated_at)
      VALUES (p_user_id, p_kw, LEAST(2.0, GREATEST(0.3, 1.0 + p_delta)), now());
    EXCEPTION WHEN unique_violation THEN
      UPDATE topic_weights
      SET weight     = LEAST(2.0, GREATEST(0.3, weight + p_delta)),
          updated_at = now()
      WHERE user_id = p_user_id AND kw = p_kw;
    END;
  END IF;
END;
$$;

-- Defense in depth: anon has no legitimate reason to call these (the app
-- only calls them from an authenticated browser session), and the runtime
-- check above shouldn't be the only line of defense.
REVOKE EXECUTE ON FUNCTION adjust_source_weight(uuid, uuid, float) FROM anon;
REVOKE EXECUTE ON FUNCTION adjust_topic_weight(uuid, text, float) FROM anon;

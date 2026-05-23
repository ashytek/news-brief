-- Workstream E: personal ranking weights
-- source_weights: per-user source preference weights (1.0 = neutral, range 0.5–1.5)
-- topic_weights:  per-user topic keyword preference weights (1.0 = neutral, range 0.3–2.0)

-- ── source_weights ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS source_weights (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  source_id  uuid NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  weight     float NOT NULL DEFAULT 1.0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, source_id)
);

CREATE INDEX IF NOT EXISTS source_weights_user_idx ON source_weights (user_id);

-- ── topic_weights ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS topic_weights (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kw         text NOT NULL,
  weight     float NOT NULL DEFAULT 1.0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, kw)
);

CREATE INDEX IF NOT EXISTS topic_weights_user_idx ON topic_weights (user_id);
CREATE INDEX IF NOT EXISTS topic_weights_kw_idx   ON topic_weights (user_id, kw);

-- ── RPCs ──────────────────────────────────────────────────────────────────────

-- adjust_source_weight: called on like (+0.1) / dislike (-0.15) from frontend
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

-- adjust_topic_weight: called nightly by update_weights.py
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

-- ── RLS ───────────────────────────────────────────────────────────────────────
ALTER TABLE source_weights ENABLE ROW LEVEL SECURITY;
ALTER TABLE topic_weights  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage own source weights" ON source_weights;
CREATE POLICY "Users manage own source weights" ON source_weights
  FOR ALL USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users manage own topic weights" ON topic_weights;
CREATE POLICY "Users manage own topic weights" ON topic_weights
  FOR ALL USING (auth.uid() = user_id);

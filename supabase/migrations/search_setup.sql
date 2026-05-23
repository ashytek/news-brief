-- =========================================================
-- Search setup — run this once in Supabase SQL Editor
-- =========================================================
-- D1: Trigger-maintained tsvector (generated columns can't use subqueries)
-- D2: Semantic search RPC (pgvector — already enabled)
-- D3: Hybrid search RPC (FTS + semantic combined)
-- =========================================================


-- D1 ─ Add regular tsvector column (trigger will keep it current)
ALTER TABLE stories
ADD COLUMN IF NOT EXISTS search_vector tsvector;


-- D1 ─ PL/pgSQL trigger function (can use loops/subqueries freely)
CREATE OR REPLACE FUNCTION stories_search_vector_update()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  bullet_text text := '';
  elem        jsonb;
BEGIN
  -- Extract all bullet texts into a single string
  IF NEW.bullets IS NOT NULL AND jsonb_typeof(NEW.bullets) = 'array' THEN
    FOR elem IN SELECT * FROM jsonb_array_elements(NEW.bullets) LOOP
      bullet_text := bullet_text || ' ' || coalesce(elem->>'text', '');
    END LOOP;
  END IF;

  NEW.search_vector :=
    setweight(to_tsvector('english', coalesce(NEW.headline, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(NEW.summary,  '')), 'B') ||
    setweight(to_tsvector('english', trim(bullet_text)),          'C');

  RETURN NEW;
END;
$$;


-- D1 ─ Fire trigger before every insert or relevant update
DROP TRIGGER IF EXISTS stories_search_vector_trigger ON stories;
CREATE TRIGGER stories_search_vector_trigger
BEFORE INSERT OR UPDATE OF headline, summary, bullets
ON stories
FOR EACH ROW EXECUTE FUNCTION stories_search_vector_update();


-- D1 ─ Backfill existing rows (UPDATE can use subqueries unlike generated cols)
UPDATE stories
SET search_vector =
  setweight(to_tsvector('english', coalesce(headline, '')), 'A') ||
  setweight(to_tsvector('english', coalesce(summary,  '')), 'B') ||
  setweight(to_tsvector('english', coalesce(
    (SELECT string_agg(elem->>'text', ' ')
     FROM jsonb_array_elements(
       CASE WHEN bullets IS NOT NULL AND jsonb_typeof(bullets) = 'array'
            THEN bullets ELSE '[]'::jsonb END
     ) AS elem
     WHERE elem->>'text' IS NOT NULL),
  '')), 'C');


-- D1 ─ GIN index for fast FTS
CREATE INDEX IF NOT EXISTS stories_search_vector_gin
ON stories USING gin(search_vector);


-- D2 ─ Semantic search (cosine similarity via pgvector)
CREATE OR REPLACE FUNCTION search_stories_semantic(
  query_embedding vector(3072),
  match_count     int  DEFAULT 20,
  category_filter text DEFAULT NULL,
  days_back       int  DEFAULT NULL
)
RETURNS TABLE (
  id             uuid,
  video_id       uuid,
  source_id      uuid,
  category       text,
  headline       text,
  summary        text,
  bullets        jsonb,
  cluster_id     uuid,
  created_at     timestamptz,
  matched_topics text[],
  similarity     float
)
LANGUAGE sql STABLE AS $$
  SELECT
    s.id, s.video_id, s.source_id, s.category,
    s.headline, s.summary, s.bullets, s.cluster_id,
    s.created_at, s.matched_topics,
    (1 - (s.embedding <=> query_embedding))::float AS similarity
  FROM stories s
  WHERE
    s.embedding IS NOT NULL
    AND (category_filter IS NULL OR s.category = category_filter)
    AND (days_back IS NULL
         OR s.created_at >= now() - (days_back || ' days')::interval)
  ORDER BY s.embedding <=> query_embedding
  LIMIT match_count;
$$;


-- D3 ─ Hybrid search: 60 % semantic + 40 % FTS
CREATE OR REPLACE FUNCTION search_stories_hybrid(
  query_text      text,
  query_embedding vector(3072),
  match_count     int  DEFAULT 20,
  category_filter text DEFAULT NULL,
  days_back       int  DEFAULT NULL
)
RETURNS TABLE (
  id             uuid,
  video_id       uuid,
  source_id      uuid,
  category       text,
  headline       text,
  summary        text,
  bullets        jsonb,
  cluster_id     uuid,
  created_at     timestamptz,
  matched_topics text[],
  fts_rank       float,
  semantic_score float,
  combined_score float
)
LANGUAGE sql STABLE AS $$
  WITH fts AS (
    SELECT s.id,
      ts_rank(s.search_vector,
              websearch_to_tsquery('english', query_text))::float AS fts_rank
    FROM stories s
    WHERE s.search_vector @@ websearch_to_tsquery('english', query_text)
      AND (category_filter IS NULL OR s.category = category_filter)
      AND (days_back IS NULL
           OR s.created_at >= now() - (days_back || ' days')::interval)
  ),
  semantic AS (
    SELECT s.id,
      (1 - (s.embedding <=> query_embedding))::float AS semantic_score
    FROM stories s
    WHERE s.embedding IS NOT NULL
      AND (category_filter IS NULL OR s.category = category_filter)
      AND (days_back IS NULL
           OR s.created_at >= now() - (days_back || ' days')::interval)
    ORDER BY s.embedding <=> query_embedding
    LIMIT match_count * 3
  ),
  combined AS (
    SELECT
      COALESCE(fts.id, semantic.id)                                 AS id,
      COALESCE(fts.fts_rank,       0)::float                        AS fts_rank,
      COALESCE(semantic.semantic_score, 0)::float                   AS semantic_score,
      (COALESCE(fts.fts_rank, 0) * 0.4
       + COALESCE(semantic.semantic_score, 0) * 0.6)::float         AS combined_score
    FROM fts FULL OUTER JOIN semantic ON fts.id = semantic.id
  )
  SELECT
    s.id, s.video_id, s.source_id, s.category,
    s.headline, s.summary, s.bullets, s.cluster_id,
    s.created_at, s.matched_topics,
    c.fts_rank, c.semantic_score, c.combined_score
  FROM combined c
  JOIN stories s ON s.id = c.id
  ORDER BY c.combined_score DESC
  LIMIT match_count;
$$;

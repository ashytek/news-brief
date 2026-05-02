-- =========================================================
-- Search setup — run this once in Supabase SQL Editor
-- =========================================================
-- D1: Full-text search vector column
-- D2: Semantic search RPC (requires pgvector — already enabled)
-- D3: Hybrid search RPC (FTS + semantic combined)
-- =========================================================


-- D1 ─ Add generated tsvector column for fast FTS
-- Weighted: headline (A) > summary (B) > bullet text (C)
ALTER TABLE stories
ADD COLUMN IF NOT EXISTS search_vector tsvector
GENERATED ALWAYS AS (
  setweight(to_tsvector('english', coalesce(headline, '')), 'A') ||
  setweight(to_tsvector('english', coalesce(summary, '')), 'B') ||
  setweight(to_tsvector('english', coalesce(
    array_to_string(
      ARRAY(
        SELECT (elem->>'text')
        FROM jsonb_array_elements(
          CASE
            WHEN bullets IS NOT NULL AND jsonb_typeof(bullets) = 'array'
            THEN bullets
            ELSE '[]'::jsonb
          END
        ) AS elem
        WHERE elem->>'text' IS NOT NULL
      ),
      ' '
    ),
  '')), 'C')
) STORED;

-- GIN index for fast FTS lookup
CREATE INDEX IF NOT EXISTS stories_search_vector_gin
ON stories USING gin(search_vector);


-- D2 ─ Semantic search (cosine similarity via pgvector)
CREATE OR REPLACE FUNCTION search_stories_semantic(
  query_embedding vector(3072),
  match_count     int     DEFAULT 20,
  category_filter text    DEFAULT NULL,
  days_back       int     DEFAULT NULL
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
LANGUAGE sql STABLE
AS $$
  SELECT
    s.id,
    s.video_id,
    s.source_id,
    s.category,
    s.headline,
    s.summary,
    s.bullets,
    s.cluster_id,
    s.created_at,
    s.matched_topics,
    (1 - (s.embedding <=> query_embedding))::float AS similarity
  FROM stories s
  WHERE
    s.embedding IS NOT NULL
    AND (category_filter IS NULL OR s.category = category_filter)
    AND (days_back IS NULL OR s.created_at >= now() - (days_back || ' days')::interval)
  ORDER BY s.embedding <=> query_embedding
  LIMIT match_count;
$$;


-- D3 ─ Hybrid search: 60% semantic + 40% FTS
CREATE OR REPLACE FUNCTION search_stories_hybrid(
  query_text      text,
  query_embedding vector(3072),
  match_count     int     DEFAULT 20,
  category_filter text    DEFAULT NULL,
  days_back       int     DEFAULT NULL
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
LANGUAGE sql STABLE
AS $$
  WITH fts AS (
    SELECT
      s.id,
      ts_rank(s.search_vector, websearch_to_tsquery('english', query_text))::float AS fts_rank
    FROM stories s
    WHERE
      s.search_vector @@ websearch_to_tsquery('english', query_text)
      AND (category_filter IS NULL OR s.category = category_filter)
      AND (days_back IS NULL OR s.created_at >= now() - (days_back || ' days')::interval)
  ),
  semantic AS (
    SELECT
      s.id,
      (1 - (s.embedding <=> query_embedding))::float AS semantic_score
    FROM stories s
    WHERE
      s.embedding IS NOT NULL
      AND (category_filter IS NULL OR s.category = category_filter)
      AND (days_back IS NULL OR s.created_at >= now() - (days_back || ' days')::interval)
    ORDER BY s.embedding <=> query_embedding
    LIMIT match_count * 3
  ),
  combined AS (
    SELECT
      COALESCE(fts.id, semantic.id)                                          AS id,
      COALESCE(fts.fts_rank, 0)::float                                       AS fts_rank,
      COALESCE(semantic.semantic_score, 0)::float                            AS semantic_score,
      (COALESCE(fts.fts_rank, 0) * 0.4
       + COALESCE(semantic.semantic_score, 0) * 0.6)::float                  AS combined_score
    FROM fts
    FULL OUTER JOIN semantic ON fts.id = semantic.id
  )
  SELECT
    s.id,
    s.video_id,
    s.source_id,
    s.category,
    s.headline,
    s.summary,
    s.bullets,
    s.cluster_id,
    s.created_at,
    s.matched_topics,
    c.fts_rank,
    c.semantic_score,
    c.combined_score
  FROM combined c
  JOIN stories s ON s.id = c.id
  ORDER BY c.combined_score DESC
  LIMIT match_count;
$$;

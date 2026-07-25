-- One-time cleanup after disabling story clustering (pipeline/cluster.py).
-- DESTRUCTIVE: permanently deletes existing clusters rows and their
-- consensus/perspectives synthesis text. The underlying stories rows and
-- their own individual summaries/embeddings are untouched — only the
-- cross-source grouping and synthesis are lost. Do not run without
-- explicit confirmation.
UPDATE stories SET cluster_id = NULL;
DELETE FROM clusters;

-- Embedding provider moved to Workers AI @cf/baai/bge-m3 (1024 dims).
-- Any existing vectors are invalid for the new model: drop them and the hash
-- so the next sweep re-embeds everything.
DROP INDEX IF EXISTS cards_embedding_idx;
ALTER TABLE cards ALTER COLUMN embedding TYPE VECTOR(1024) USING NULL::vector(1024);
UPDATE cards SET embedding_hash = NULL, embedded_at = NULL;
CREATE INDEX IF NOT EXISTS cards_embedding_idx ON cards USING hnsw (embedding vector_cosine_ops);

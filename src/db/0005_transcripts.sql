-- Transcripts: one row per card (status of the capture), chunked text in card_chunks so long transcripts
-- are searchable per passage (FTS + their own embeddings) without bloating cards.body.
CREATE TABLE IF NOT EXISTS transcripts (
  card_id      UUID PRIMARY KEY REFERENCES cards(id) ON DELETE CASCADE,
  status       TEXT NOT NULL,            -- pending | running | done | unavailable | failed
  source       TEXT NOT NULL,            -- youtube | upload
  file_id      UUID REFERENCES files(id) ON DELETE SET NULL,
  language     TEXT,
  model        TEXT,
  total_chunks INTEGER,
  error        TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS card_chunks (
  id        BIGSERIAL PRIMARY KEY,
  card_id   UUID NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  seq       INTEGER NOT NULL,
  start_ms  INTEGER,
  end_ms    INTEGER,
  text      TEXT NOT NULL,
  search    TSVECTOR GENERATED ALWAYS AS (to_tsvector('english', text)) STORED,
  embedding VECTOR(1024),
  UNIQUE (card_id, seq)
);
CREATE INDEX IF NOT EXISTS card_chunks_search_idx ON card_chunks USING GIN (search);
CREATE INDEX IF NOT EXISTS card_chunks_embedding_idx ON card_chunks USING hnsw (embedding vector_cosine_ops);

CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- The universal entity
CREATE TABLE IF NOT EXISTS cards (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type        TEXT NOT NULL,
  title       TEXT,
  body        TEXT,
  url         TEXT,
  props       JSONB NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at  TIMESTAMPTZ,

  search      TSVECTOR GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce(title,'')), 'A') ||
    setweight(to_tsvector('english', coalesce(body,'')),  'B')
  ) STORED,

  embedding      VECTOR(1536),
  embedding_hash TEXT,
  embedded_at    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS cards_search_idx    ON cards USING GIN (search);
CREATE INDEX IF NOT EXISTS cards_title_trgm    ON cards USING GIN (title gin_trgm_ops);
CREATE INDEX IF NOT EXISTS cards_type_idx      ON cards (type) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS cards_inbox_idx     ON cards (created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS cards_embedding_idx ON cards USING hnsw (embedding vector_cosine_ops);

-- Explicit links between cards
CREATE TABLE IF NOT EXISTS edges (
  from_card  UUID NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  to_card    UUID NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  label      TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (from_card, to_card)
);

-- Spatial membership: a card's position on a board
CREATE TABLE IF NOT EXISTS placements (
  board_id   UUID NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  card_id    UUID NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  x DOUBLE PRECISION NOT NULL,
  y DOUBLE PRECISION NOT NULL,
  w DOUBLE PRECISION,
  h DOUBLE PRECISION,
  z INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (board_id, card_id)
);
CREATE INDEX IF NOT EXISTS placements_card_idx ON placements (card_id);

-- Tags
CREATE TABLE IF NOT EXISTS tags (
  id    SERIAL PRIMARY KEY,
  name  TEXT NOT NULL UNIQUE,
  color TEXT
);

CREATE TABLE IF NOT EXISTS card_tags (
  card_id UUID NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  tag_id  INT  NOT NULL REFERENCES tags(id)  ON DELETE CASCADE,
  PRIMARY KEY (card_id, tag_id)
);

-- Files stored in R2
CREATE TABLE IF NOT EXISTS files (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  r2_prefix  TEXT NOT NULL,
  mime       TEXT NOT NULL,
  bytes      BIGINT NOT NULL,
  width      INT,
  height     INT,
  sha256     TEXT NOT NULL UNIQUE,
  status     TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Reference ledger: who uses a file (drives garbage collection)
CREATE TABLE IF NOT EXISTS file_refs (
  file_id UUID NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  card_id UUID NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  role    TEXT NOT NULL,
  PRIMARY KEY (file_id, card_id, role)
);

-- Login rate limiting: fixed-window counter (serverless-safe).
CREATE TABLE IF NOT EXISTS login_attempts (
  ip           TEXT NOT NULL,
  window_start TIMESTAMPTZ NOT NULL,
  count        INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (ip, window_start)
);

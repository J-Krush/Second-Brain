-- Every card gets a `note`: the user's own take on it, separate from the
-- content (a quote's text, a thought, a link's page). Notes are searchable,
-- so the generated tsvector is rebuilt to include them (a generated column's
-- expression can't be altered in place).
ALTER TABLE cards ADD COLUMN IF NOT EXISTS note TEXT;

DROP INDEX IF EXISTS cards_search_idx;
ALTER TABLE cards DROP COLUMN search;
ALTER TABLE cards ADD COLUMN search TSVECTOR GENERATED ALWAYS AS (
  setweight(to_tsvector('english', coalesce(title,'')), 'A') ||
  setweight(to_tsvector('english', coalesce(body,'')),  'B') ||
  setweight(to_tsvector('english', coalesce(note,'')),  'B')
) STORED;
CREATE INDEX IF NOT EXISTS cards_search_idx ON cards USING GIN (search);

-- Link and video bodies were already "why I saved this"; they become the note.
-- Bodies that embed files stay put: inline file refs are synced from `body`,
-- so moving them would let GC collect the images.
UPDATE cards
SET note = body, body = NULL
WHERE type IN ('link', 'video') AND body IS NOT NULL AND body NOT LIKE '%file:%' AND note IS NULL;

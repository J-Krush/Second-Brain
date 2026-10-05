ALTER TABLE cards ADD COLUMN IF NOT EXISTS triaged_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS cards_untriaged_idx ON cards (created_at DESC) WHERE deleted_at IS NULL AND triaged_at IS NULL;
-- Anything already filed (tagged, on a board, or a board itself) counts as triaged.
UPDATE cards c SET triaged_at = c.updated_at WHERE c.triaged_at IS NULL AND (c.type = 'board' OR EXISTS (SELECT 1 FROM card_tags t WHERE t.card_id = c.id) OR EXISTS (SELECT 1 FROM placements p WHERE p.card_id = c.id));
ALTER TABLE edges ADD COLUMN IF NOT EXISTS description TEXT;

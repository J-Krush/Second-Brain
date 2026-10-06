-- Single-user app settings as JSON documents keyed by feature ("ask", ...).
-- Each feature owns a zod schema that fills defaults, so missing keys or an
-- outdated document never break a page.
CREATE TABLE IF NOT EXISTS settings (
  key        text PRIMARY KEY,
  value      jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

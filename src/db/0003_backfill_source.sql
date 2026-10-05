-- Every card carries props.source so provenance can be filtered in SQL.
-- Cards created before provenance existed: a URL means the web (domain from
-- the URL, port and www. dropped, matching sourceOf()), otherwise typed.
UPDATE cards
SET props = props || jsonb_build_object(
  'source',
  CASE
    WHEN url IS NOT NULL AND substring(url FROM '^https?://(?:www\.)?([^/?#:]+)') IS NOT NULL
      THEN jsonb_build_object('via', 'web', 'domain', lower(substring(url FROM '^https?://(?:www\.)?([^/?#:]+)')))
    ELSE jsonb_build_object('via', 'typed')
  END
)
WHERE props -> 'source' IS NULL;

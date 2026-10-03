-- TomeKeep D1 Migration 0007 — make legacy price rows decodable by native clients

UPDATE price_cache
SET cache_key = COALESCE(NULLIF(book_isbn, ''), id),
    title = COALESCE(title, ''),
    expires_at = COALESCE(expires_at, datetime(fetched_at, '+1 day')),
    updated_at = COALESCE(updated_at, fetched_at, datetime('now'))
WHERE cache_key IS NULL OR title IS NULL OR expires_at IS NULL;

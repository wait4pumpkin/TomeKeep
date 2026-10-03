-- TomeKeep D1 Migration 0006 — lossless native price-cache sync fields

ALTER TABLE price_cache ADD COLUMN cache_key TEXT;
ALTER TABLE price_cache ADD COLUMN title TEXT;
ALTER TABLE price_cache ADD COLUMN author TEXT;
ALTER TABLE price_cache ADD COLUMN expires_at TEXT;
ALTER TABLE price_cache ADD COLUMN message TEXT;
ALTER TABLE price_cache ADD COLUMN updated_at TEXT NOT NULL DEFAULT (datetime('now'));

CREATE INDEX IF NOT EXISTS idx_price_owner_updated
  ON price_cache(owner_id, updated_at, id);

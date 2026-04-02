-- TomeKeep D1 Schema
-- Apply with: wrangler d1 execute tomekeep-db --file=./packages/web/migrations/0001_initial_schema.sql

-- Users
CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  username      TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  name          TEXT NOT NULL,
  language      TEXT NOT NULL DEFAULT 'zh',
  ui_prefs      TEXT NOT NULL DEFAULT '{}',
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Invite codes
CREATE TABLE IF NOT EXISTS invite_codes (
  code        TEXT PRIMARY KEY,
  created_by  TEXT NOT NULL REFERENCES users(id),
  used_by     TEXT REFERENCES users(id),
  used_at     TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Books (inventory)
CREATE TABLE IF NOT EXISTS books (
  id          TEXT PRIMARY KEY,
  owner_id    TEXT NOT NULL REFERENCES users(id),
  title       TEXT NOT NULL,
  author      TEXT NOT NULL DEFAULT '',
  isbn        TEXT,
  publisher   TEXT,
  cover_key   TEXT,
  detail_url  TEXT,
  tags        TEXT NOT NULL DEFAULT '[]',
  added_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at  TEXT
);
CREATE INDEX IF NOT EXISTS idx_books_owner   ON books(owner_id);
CREATE INDEX IF NOT EXISTS idx_books_updated ON books(updated_at);
CREATE INDEX IF NOT EXISTS idx_books_isbn    ON books(isbn);

-- Wishlist
CREATE TABLE IF NOT EXISTS wishlist (
  id          TEXT PRIMARY KEY,
  owner_id    TEXT NOT NULL REFERENCES users(id),
  title       TEXT NOT NULL,
  author      TEXT NOT NULL DEFAULT '',
  isbn        TEXT,
  publisher   TEXT,
  cover_key   TEXT,
  detail_url  TEXT,
  tags        TEXT NOT NULL DEFAULT '[]',
  priority    TEXT NOT NULL DEFAULT 'medium',
  pending_buy INTEGER NOT NULL DEFAULT 0,
  added_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at  TEXT
);
CREATE INDEX IF NOT EXISTS idx_wishlist_owner   ON wishlist(owner_id);
CREATE INDEX IF NOT EXISTS idx_wishlist_updated ON wishlist(updated_at);

-- Reading states
CREATE TABLE IF NOT EXISTS reading_states (
  user_id      TEXT NOT NULL REFERENCES users(id),
  book_id      TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  status       TEXT NOT NULL DEFAULT 'unread',
  completed_at TEXT,
  updated_at   TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, book_id)
);
CREATE INDEX IF NOT EXISTS idx_reading_states_updated ON reading_states(updated_at);

-- Price cache (written by desktop, read-only for PWA)
CREATE TABLE IF NOT EXISTS price_cache (
  id          TEXT PRIMARY KEY,
  owner_id    TEXT NOT NULL REFERENCES users(id),
  book_isbn   TEXT NOT NULL,
  channel     TEXT NOT NULL,
  status      TEXT NOT NULL,
  price_cny   REAL,
  url         TEXT,
  product_id  TEXT,
  source      TEXT DEFAULT 'auto',
  fetched_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_price_isbn    ON price_cache(book_isbn);
CREATE INDEX IF NOT EXISTS idx_price_owner   ON price_cache(owner_id);

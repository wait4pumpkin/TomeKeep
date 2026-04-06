-- TomeKeep D1 Migration 0003 — per-account reading profiles
-- Profiles allow multiple household members to share one account while
-- maintaining independent reading states.
-- Apply with:
--   wrangler d1 execute tomekeep-db --file=./packages/web/migrations/0003_profiles.sql

-- Profiles table
CREATE TABLE IF NOT EXISTS profiles (
  id         TEXT PRIMARY KEY,           -- client-generated UUID
  owner_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_profiles_owner ON profiles(owner_id);

-- Add profile_id to reading_states.
-- NULL means the row was created before profiles existed and belongs to the
-- account owner's default profile.
ALTER TABLE reading_states ADD COLUMN profile_id TEXT REFERENCES profiles(id) ON DELETE CASCADE;

-- Update PK to include profile_id so each (profile, book) pair has its own row.
-- SQLite doesn't support DROP PRIMARY KEY, so we recreate the table.
CREATE TABLE reading_states_new (
  user_id      TEXT NOT NULL REFERENCES users(id),
  book_id      TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  profile_id   TEXT REFERENCES profiles(id) ON DELETE CASCADE,
  status       TEXT NOT NULL DEFAULT 'unread',
  completed_at TEXT,
  updated_at   TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, book_id, profile_id)
);
CREATE INDEX IF NOT EXISTS idx_reading_states_new_updated ON reading_states_new(updated_at);

INSERT INTO reading_states_new (user_id, book_id, profile_id, status, completed_at, updated_at)
SELECT user_id, book_id, NULL, status, completed_at, updated_at
FROM reading_states;

DROP TABLE reading_states;
ALTER TABLE reading_states_new RENAME TO reading_states;

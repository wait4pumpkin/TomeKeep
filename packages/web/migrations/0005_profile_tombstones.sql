-- TomeKeep D1 Migration 0005 — profile tombstones for native multi-device sync

ALTER TABLE profiles ADD COLUMN deleted_at TEXT;
CREATE INDEX IF NOT EXISTS idx_profiles_owner_updated
  ON profiles(owner_id, updated_at);

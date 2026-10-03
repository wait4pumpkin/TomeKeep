-- Ensure legacy account-level reading states (profile_id IS NULL) have the
-- same one-row-per-book semantics as profile-specific states.
--
-- SQLite considers NULL values distinct inside a composite primary key, so
-- PRIMARY KEY (user_id, book_id, profile_id) alone does not prevent duplicate
-- default-profile rows. Keep the most recently updated row before adding the
-- partial unique index.

DELETE FROM reading_states
WHERE rowid IN (
  SELECT rowid
  FROM (
    SELECT
      rowid,
      ROW_NUMBER() OVER (
        PARTITION BY user_id, book_id
        ORDER BY updated_at DESC, rowid DESC
      ) AS duplicate_rank
    FROM reading_states
    WHERE profile_id IS NULL
  )
  WHERE duplicate_rank > 1
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_reading_states_default_unique
ON reading_states(user_id, book_id)
WHERE profile_id IS NULL;

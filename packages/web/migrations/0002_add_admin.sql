-- TomeKeep D1 Migration 0002
-- Add is_admin flag to users table.
-- Apply with:
--   wrangler d1 execute tomekeep-db --local --file=migrations/0002_add_admin.sql
--   wrangler d1 execute tomekeep-db --remote --file=migrations/0002_add_admin.sql

ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0;

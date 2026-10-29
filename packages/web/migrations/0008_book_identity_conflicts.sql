-- Keep legacy duplicates intact, but reject new races atomically. Triggers
-- enforce active owner/ISBN uniqueness without deleting or rewriting old rows.
ALTER TABLE books ADD COLUMN revision INTEGER NOT NULL DEFAULT 1;

CREATE TRIGGER books_active_isbn_insert
BEFORE INSERT ON books
WHEN NEW.deleted_at IS NULL AND NEW.isbn IS NOT NULL AND NEW.isbn <> ''
 AND EXISTS (SELECT 1 FROM books WHERE owner_id = NEW.owner_id
             AND isbn = NEW.isbn AND deleted_at IS NULL)
BEGIN
  SELECT RAISE(ABORT, 'duplicate_isbn');
END;

CREATE TRIGGER books_active_isbn_update
BEFORE UPDATE OF isbn, deleted_at, owner_id ON books
WHEN NEW.deleted_at IS NULL AND NEW.isbn IS NOT NULL AND NEW.isbn <> ''
 AND EXISTS (SELECT 1 FROM books WHERE owner_id = NEW.owner_id
             AND isbn = NEW.isbn AND id <> NEW.id AND deleted_at IS NULL)
BEGIN
  SELECT RAISE(ABORT, 'duplicate_isbn');
END;

CREATE TRIGGER books_revision_update
AFTER UPDATE ON books WHEN NEW.revision = OLD.revision
BEGIN
  UPDATE books SET revision = OLD.revision + 1 WHERE id = NEW.id;
END;

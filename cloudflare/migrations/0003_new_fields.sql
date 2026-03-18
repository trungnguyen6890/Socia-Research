-- Add content enrichment fields to content_items

ALTER TABLE content_items ADD COLUMN content_type TEXT;
ALTER TABLE content_items ADD COLUMN language TEXT;
ALTER TABLE content_items ADD COLUMN author_name TEXT;
ALTER TABLE content_items ADD COLUMN author_verified INTEGER NOT NULL DEFAULT 0;
ALTER TABLE content_items ADD COLUMN has_media INTEGER NOT NULL DEFAULT 0;
ALTER TABLE content_items ADD COLUMN is_truncated INTEGER NOT NULL DEFAULT 0;

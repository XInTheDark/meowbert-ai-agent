ALTER TABLE source_file_links
  ADD COLUMN IF NOT EXISTS link_kind text NOT NULL DEFAULT 'file';

ALTER TABLE source_file_links
  DROP CONSTRAINT IF EXISTS source_file_links_provider_check;

ALTER TABLE source_file_links
  ADD CONSTRAINT source_file_links_provider_check
  CHECK (provider IN ('onedrive', 'google-drive'));

ALTER TABLE source_file_links
  DROP CONSTRAINT IF EXISTS source_file_links_link_kind_check;

ALTER TABLE source_file_links
  ADD CONSTRAINT source_file_links_link_kind_check
  CHECK (link_kind IN ('file', 'folder'));

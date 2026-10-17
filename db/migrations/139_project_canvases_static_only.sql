-- Canvases are always served as static files now; dev-server mode and its settings are gone.
-- Framework canvases build to static output and point their entry at the built HTML.
ALTER TABLE project_canvases DROP COLUMN IF EXISTS runtime_mode;
ALTER TABLE project_canvases DROP COLUMN IF EXISTS dev_server_json;

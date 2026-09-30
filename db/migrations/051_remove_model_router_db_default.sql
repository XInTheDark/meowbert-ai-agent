ALTER TABLE platform_settings
  ALTER COLUMN model_routers_json DROP DEFAULT;

ALTER TABLE platform_settings
  ALTER COLUMN model_routers_json DROP NOT NULL;

ALTER TABLE shared_connector_settings
  ADD COLUMN IF NOT EXISTS telegram_webhook_secret text;

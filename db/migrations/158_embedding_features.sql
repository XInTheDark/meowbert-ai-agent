-- Admins can switch each embedding feature on or off. Memory search stays on by default; session
-- history search embeds every task's context history, so it starts off.
ALTER TABLE memory_embedding_settings
  ADD COLUMN IF NOT EXISTS memory_search_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS history_search_enabled boolean NOT NULL DEFAULT false;

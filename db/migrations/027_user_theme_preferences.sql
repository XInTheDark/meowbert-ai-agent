ALTER TABLE users
  ADD COLUMN IF NOT EXISTS theme_preference text NOT NULL DEFAULT 'system';

ALTER TABLE users
  DROP CONSTRAINT IF EXISTS users_theme_preference_check;

ALTER TABLE users
  ADD CONSTRAINT users_theme_preference_check
  CHECK (
    theme_preference IN (
      'system',
      'light',
      'dark',
      'github-light',
      'github-dark',
      'dracula',
      'nord',
      'solarized-light',
      'solarized-dark',
      'tokyo-night',
      'catppuccin-latte',
      'catppuccin-mocha',
      'aurora',
      'sunset'
    )
  );


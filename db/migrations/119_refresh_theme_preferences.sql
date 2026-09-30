ALTER TABLE users DROP CONSTRAINT IF EXISTS users_theme_preference_check;

UPDATE users SET theme_preference = CASE theme_preference
  WHEN 'aurora-light' THEN 'signal-light'
  WHEN 'alpine-frost' THEN 'signal-light'
  WHEN 'blueprint-light' THEN 'signal-light'
  WHEN 'graphite' THEN 'signal-light'
  WHEN 'aurora' THEN 'signal-dark'
  WHEN 'alpine-night' THEN 'signal-dark'
  WHEN 'blueprint' THEN 'signal-dark'
  WHEN 'graphite-dark' THEN 'signal-dark'
  WHEN 'sunset-light' THEN 'index-light'
  WHEN 'rose-dawn' THEN 'index-light'
  WHEN 'linen' THEN 'index-light'
  WHEN 'copper-slate-light' THEN 'index-light'
  WHEN 'sunset' THEN 'index-dark'
  WHEN 'rose-dusk' THEN 'index-dark'
  WHEN 'ember-noir' THEN 'index-dark'
  WHEN 'linen-dark' THEN 'index-dark'
  WHEN 'copper-slate' THEN 'index-dark'
  WHEN 'moonlit-garden-light' THEN 'tide-light'
  WHEN 'jade-paper' THEN 'tide-light'
  WHEN 'moss-studio' THEN 'tide-light'
  WHEN 'moonlit-garden' THEN 'tide-dark'
  WHEN 'jade-night' THEN 'tide-dark'
  WHEN 'moss-studio-dark' THEN 'tide-dark'
  ELSE theme_preference
END;

ALTER TABLE users ALTER COLUMN theme_preference SET DEFAULT 'dark';
ALTER TABLE users ADD CONSTRAINT users_theme_preference_check
  CHECK (theme_preference IN (
    'system',
    'light',
    'dark',
    'github-light',
    'github-dark',
    'dracula',
    'nord',
    'nord-light',
    'solarized-light',
    'solarized-dark',
    'tokyo-day',
    'tokyo-night',
    'catppuccin-latte',
    'catppuccin-mocha',
    'gpt',
    'google-classic',
    'google-dark',
    'trash',
    'viber',
    'openai-pride',
    'usa',
    'index-light',
    'index-dark',
    'tide-light',
    'tide-dark',
    'signal-light',
    'signal-dark'
  ));

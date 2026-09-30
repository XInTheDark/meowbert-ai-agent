ALTER TABLE users
  DROP CONSTRAINT IF EXISTS users_theme_preference_check;

UPDATE users
SET theme_preference = 'system'
WHERE theme_preference IN ('amethyst-haze', 'velvet-emerald');

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
      'usa',
      'openai-pride',
      'google-classic',
      'gpt',
      'trash',
      'counter-strike-mirage',
      'counter-strike-nuke',
      'aero',
      'aurora',
      'sunset',
      'moonlit-garden',
      'rose-dawn',
      'ember-noir',
      'jade-paper',
      'alpine-frost',
      'linen',
      'blueprint',
      'copper-slate',
      'moss-studio',
      'graphite',
      'graphite-dark'
    )
  );

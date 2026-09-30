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
      'usa',
      'openai-pride',
      'google-classic',
      'counter-strike-mirage',
      'counter-strike-nuke',
      'aero',
      'aurora',
      'sunset',
      'moonlit-garden',
      'rose-dawn',
      'ember-noir',
      'jade-paper',
      'amethyst-haze',
      'alpine-frost',
      'velvet-emerald'
    )
  );

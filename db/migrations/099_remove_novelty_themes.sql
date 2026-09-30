-- Remove the aero and counter-strike novelty themes.
--
-- These three themes required ~2,000 lines of per-theme overrides in styles.css
-- (roughly a third of the stylesheet) and are being retired. Anyone currently on
-- one of them falls back to 'system'.
--
-- This also realigns users_theme_preference_check with THEME_MODE_VALUES. The
-- constraint had not been updated since migration 072, so every theme added after
-- it (viber, nord-light, tokyo-day, the -light/-dark variants) was rejected by the
-- database on save while the API accepted it.

ALTER TABLE users
  DROP CONSTRAINT IF EXISTS users_theme_preference_check;

UPDATE users
SET theme_preference = 'system'
WHERE theme_preference IN ('aero', 'counter-strike-mirage', 'counter-strike-nuke');

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
      'aurora-light',
      'aurora',
      'sunset-light',
      'sunset',
      'moonlit-garden-light',
      'moonlit-garden',
      'rose-dawn',
      'rose-dusk',
      'ember-noir',
      'jade-paper',
      'jade-night',
      'alpine-frost',
      'alpine-night',
      'linen',
      'linen-dark',
      'blueprint-light',
      'blueprint',
      'copper-slate-light',
      'copper-slate',
      'moss-studio',
      'moss-studio-dark',
      'graphite',
      'graphite-dark'
    )
  );

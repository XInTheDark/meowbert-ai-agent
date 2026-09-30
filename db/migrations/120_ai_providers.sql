CREATE TABLE ai_providers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  base_url text NOT NULL CHECK (length(btrim(base_url)) > 0),
  api_key text NOT NULL CHECK (length(btrim(api_key)) > 0),
  is_selected boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX ai_providers_single_selected
  ON ai_providers (is_selected) WHERE is_selected;

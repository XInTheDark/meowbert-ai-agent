ALTER TABLE users
  ADD COLUMN IF NOT EXISTS is_super_admin boolean NOT NULL DEFAULT false;

WITH first_user AS (
  SELECT id
    FROM users
   ORDER BY created_at ASC, id ASC
   LIMIT 1
)
UPDATE users
   SET is_super_admin = true
 WHERE id = (SELECT id FROM first_user)
   AND NOT EXISTS (
     SELECT 1
       FROM users
      WHERE is_super_admin = true
   );

CREATE TABLE IF NOT EXISTS platform_settings (
  id smallint PRIMARY KEY CHECK (id = 1),
  allow_user_signup boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO platform_settings (id, allow_user_signup)
VALUES (1, false)
ON CONFLICT (id) DO NOTHING;

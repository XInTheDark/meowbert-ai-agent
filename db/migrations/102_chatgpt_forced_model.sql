ALTER TABLE user_chatgpt_auth
  RENAME COLUMN selected_model TO forced_model;

ALTER TABLE user_chatgpt_auth
  ALTER COLUMN forced_model DROP DEFAULT;

UPDATE user_chatgpt_auth
   SET forced_model = NULL;

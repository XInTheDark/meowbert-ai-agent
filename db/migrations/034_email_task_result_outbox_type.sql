ALTER TABLE email_outbox
  DROP CONSTRAINT IF EXISTS email_outbox_message_type_check;

ALTER TABLE email_outbox
  ADD CONSTRAINT email_outbox_message_type_check
    CHECK (message_type IN ('signup_verification', 'password_reset', 'newsletter', 'task_result'));

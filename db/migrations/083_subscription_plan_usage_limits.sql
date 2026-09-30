ALTER TABLE subscription_plans
  ADD COLUMN IF NOT EXISTS usage_limits_json jsonb NOT NULL DEFAULT '[]'::jsonb;

UPDATE subscription_plans
   SET usage_limits_json = jsonb_build_array(
         jsonb_build_object(
           'weightedTokens',
           monthly_token_quota,
           'durationDays',
           30
         )
       )
 WHERE usage_limits_json = '[]'::jsonb
   AND monthly_token_quota > 0;

ALTER TABLE subscription_plans
  DROP CONSTRAINT IF EXISTS subscription_plans_usage_limits_json_array_check;

ALTER TABLE subscription_plans
  ADD CONSTRAINT subscription_plans_usage_limits_json_array_check
  CHECK (jsonb_typeof(usage_limits_json) = 'array');

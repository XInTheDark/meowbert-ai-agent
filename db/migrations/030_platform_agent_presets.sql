ALTER TABLE platform_settings
  ADD COLUMN IF NOT EXISTS agent_presets_json jsonb NOT NULL DEFAULT '[
    {
      "id": "default",
      "name": "Default",
      "description": "Balanced defaults for most tasks.",
      "payload": {
        "model": "gpt-5.3-codex",
        "reasoning": {
          "effort": "high"
        }
      }
    },
    {
      "id": "deep-think",
      "name": "Deep think",
      "description": "Higher reasoning effort for complex problems.",
      "payload": {
        "model": "gpt-5.3-codex",
        "reasoning": {
          "effort": "xhigh"
        }
      }
    },
    {
      "id": "fast",
      "name": "Fast",
      "description": "Lower reasoning effort for quick turnarounds.",
      "payload": {
        "model": "gpt-5.3-codex",
        "reasoning": {
          "effort": "low"
        }
      }
    }
  ]'::jsonb;

UPDATE platform_settings
   SET agent_presets_json = '[
     {
       "id": "default",
       "name": "Default",
       "description": "Balanced defaults for most tasks.",
       "payload": {
         "model": "gpt-5.3-codex",
         "reasoning": {
           "effort": "high"
         }
       }
     },
     {
       "id": "deep-think",
       "name": "Deep think",
       "description": "Higher reasoning effort for complex problems.",
       "payload": {
         "model": "gpt-5.3-codex",
         "reasoning": {
           "effort": "xhigh"
         }
       }
     },
     {
       "id": "fast",
       "name": "Fast",
       "description": "Lower reasoning effort for quick turnarounds.",
       "payload": {
         "model": "gpt-5.3-codex",
         "reasoning": {
           "effort": "low"
         }
       }
     }
   ]'::jsonb
 WHERE agent_presets_json IS NULL
    OR jsonb_typeof(agent_presets_json) <> 'array'
    OR jsonb_array_length(agent_presets_json) = 0;

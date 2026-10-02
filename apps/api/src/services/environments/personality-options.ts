import {
  DEFAULT_ENVIRONMENT_PERSONALITY_ID,
  listPersonalityOptions,
  loadPersonalityPromptCatalog,
  resolveEnvironmentPersonalityId
} from "@meowbert/shared";

const personalityPromptCatalog = loadPersonalityPromptCatalog();
export const personalityOptions = listPersonalityOptions(personalityPromptCatalog);
export const personalityDefaultId = resolveEnvironmentPersonalityId({
  requestedId: null,
  catalog: personalityPromptCatalog,
  defaultId: DEFAULT_ENVIRONMENT_PERSONALITY_ID
});

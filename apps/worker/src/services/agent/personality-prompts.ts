import {
  DEFAULT_ENVIRONMENT_PERSONALITY_ID,
  NONE_ENVIRONMENT_PERSONALITY_ID,
  loadPersonalityBasePrompt,
  loadPersonalityPromptCatalog,
  resolveEnvironmentPersonalityId
} from "@meowbert/shared";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

interface ResolvedEnvironmentPersonality {
  id: string | null;
  basePromptText: string | null;
  promptText: string | null;
}

const PERSONALITY_BASE_PROMPT = loadPersonalityBasePrompt();
const PERSONALITY_CATALOG = loadPersonalityPromptCatalog();

function extractEnvironmentDefaultContext(
  envPayload: Record<string, unknown> | undefined
): Record<string, unknown> | null {
  if (!envPayload) {
    return null;
  }

  const defaultContext = envPayload.default_context;
  if (!isPlainObject(defaultContext)) {
    return null;
  }

  return defaultContext;
}

export function resolveEnvironmentPersonality(
  envPayload: Record<string, unknown> | undefined
): ResolvedEnvironmentPersonality {
  const context = extractEnvironmentDefaultContext(envPayload);
  const resolvedId = resolveEnvironmentPersonalityId({
    requestedId: context?.personality,
    catalog: PERSONALITY_CATALOG,
    defaultId: DEFAULT_ENVIRONMENT_PERSONALITY_ID
  });

  if (!resolvedId) {
    return {
      id: resolvedId,
      basePromptText: null,
      promptText: null
    };
  }

  const promptText = PERSONALITY_CATALOG.byId.get(resolvedId)?.promptText?.trim() ?? "";
  const injectBasePrompt = resolvedId !== NONE_ENVIRONMENT_PERSONALITY_ID;

  return {
    id: resolvedId,
    basePromptText:
      injectBasePrompt && PERSONALITY_BASE_PROMPT.length > 0 ? PERSONALITY_BASE_PROMPT : null,
    promptText: promptText.length > 0 ? promptText : null
  };
}

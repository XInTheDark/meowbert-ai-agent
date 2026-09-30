const ENVIRONMENT_NON_RESPONSE_KEYS = new Set([
  "responses",
  "default_context",
  "task_cleanup",
  "debug",
  "sandbox",
  "memory",
  "project_context",
  "persistent_runtime"
]);

const AGENT_PRESET_NON_RESPONSE_KEYS = new Set([
  "responses",
  "model"
]);

const DEFAULT_RESPONSES_SETTINGS: Record<string, unknown> = {
  reasoning: {
    effort: "high",
    summary: "detailed"
  },
  store: false
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function deepCloneJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => deepCloneJsonValue(entry));
  }

  if (isPlainObject(value)) {
    const clone: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      clone[key] = deepCloneJsonValue(entry);
    }
    return clone;
  }

  return value;
}

function normalizeNestedOpaquePayload(
  payload: Record<string, unknown>,
  nonNestedKeys: ReadonlySet<string>
): Record<string, unknown> {
  const normalized = { ...payload };
  const nestedPayload = isPlainObject(normalized.responses)
    ? deepCloneJsonValue(normalized.responses) as Record<string, unknown>
    : {};

  for (const [key, value] of Object.entries(payload)) {
    if (nonNestedKeys.has(key)) {
      continue;
    }

    nestedPayload[key] = deepCloneJsonValue(value);
    delete normalized[key];
  }

  if (Object.keys(nestedPayload).length === 0) {
    delete normalized.responses;
  } else {
    normalized.responses = nestedPayload;
  }

  return normalized;
}

export function createDefaultEnvironmentJsonPayload(): Record<string, unknown> {
  return {
    responses: deepCloneJsonValue(DEFAULT_RESPONSES_SETTINGS) as Record<string, unknown>
  };
}

export function normalizeEnvironmentResponsesSettings(payload: Record<string, unknown>): Record<string, unknown> {
  return normalizeNestedOpaquePayload(payload, ENVIRONMENT_NON_RESPONSE_KEYS);
}

export function normalizeAgentPresetPayload(payload: Record<string, unknown>): Record<string, unknown> {
  return normalizeNestedOpaquePayload(payload, AGENT_PRESET_NON_RESPONSE_KEYS);
}

export function extractResponsesApiPayload(payload: Record<string, unknown>): Record<string, unknown> {
  if (!isPlainObject(payload.responses)) {
    return {};
  }

  const extracted = deepCloneJsonValue(payload.responses) as Record<string, unknown>;
  if (!isPlainObject(extracted.reasoning)) {
    return extracted;
  }

  const reasoning = { ...extracted.reasoning };
  if (reasoning.summary === undefined && reasoning.generate_summary === undefined) {
    reasoning.summary = "detailed";
  }
  extracted.reasoning = reasoning;

  return extracted;
}

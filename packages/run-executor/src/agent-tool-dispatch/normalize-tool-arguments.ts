// Repairs harmless deviations from a tool's JSON schema before its handler validates the call:
// strict schemas mark nullable keys required, yet models leave them out, and models sometimes
// quote numbers ("100"). Anything else is left for the handler to accept or reject.

type JsonSchemaNode = {
  type?: unknown;
  properties?: Record<string, JsonSchemaNode>;
  items?: JsonSchemaNode;
};

const NUMERIC_STRING = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;

function schemaTypes(schema: JsonSchemaNode): unknown[] {
  return Array.isArray(schema.type) ? schema.type : [schema.type];
}

function coerceNumericString(value: string, types: unknown[]): number | string {
  const wantsInteger = types.includes("integer");
  if (types.includes("string") || (!types.includes("number") && !wantsInteger)) return value;
  const trimmed = value.trim();
  if (!NUMERIC_STRING.test(trimmed)) return value;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed)) return value;
  if (wantsInteger && !types.includes("number") && !Number.isInteger(parsed)) return value;
  return parsed;
}

function normalizeObject(schema: JsonSchemaNode, value: Record<string, unknown>): Record<string, unknown> {
  const properties = schema.properties ?? {};
  const normalized: Record<string, unknown> = { ...value };
  for (const [name, propertySchema] of Object.entries(properties)) {
    if (!propertySchema || typeof propertySchema !== "object") continue;
    if (!(name in normalized)) {
      if (schemaTypes(propertySchema).includes("null")) normalized[name] = null;
      continue;
    }
    normalized[name] = normalizeValue(propertySchema, normalized[name]);
  }
  return normalized;
}

function normalizeValue(schema: JsonSchemaNode, value: unknown): unknown {
  if (typeof value === "string") return coerceNumericString(value, schemaTypes(schema));
  if (Array.isArray(value)) {
    const items = schema.items;
    return items && typeof items === "object" ? value.map((item) => normalizeValue(items, item)) : value;
  }
  if (value && typeof value === "object" && schema.properties) {
    return normalizeObject(schema, value as Record<string, unknown>);
  }
  return value;
}

export function normalizeToolArguments(parameters: unknown, args: Record<string, unknown>): Record<string, unknown> {
  if (!parameters || typeof parameters !== "object") return args;
  return normalizeObject(parameters as JsonSchemaNode, args);
}

// Same repair for a raw JSON arguments string; malformed JSON is returned untouched for the handler to report.
export function normalizeToolArgumentsText(parameters: unknown, argumentsText: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(argumentsText);
  } catch {
    return argumentsText;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return argumentsText;
  return JSON.stringify(normalizeToolArguments(parameters, parsed as Record<string, unknown>));
}

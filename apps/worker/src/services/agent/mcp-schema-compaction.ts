/*
 * MCP servers (Pydantic/FastMCP especially) emit verbose input schemas: `anyOf [X, null]` with
 * `default: null` for every optional field, and the same shared field descriptions repeated in each
 * `oneOf` variant. Skill tools are sent non-strict, so these rewrites keep what the model may send
 * the same while cutting the schema tokens sent on every request.
 */

type JsonSchema = Record<string, unknown>;

const SCHEMA_MAP_KEYS = ["properties", "patternProperties", "$defs", "definitions"] as const;
const SCHEMA_VALUE_KEYS = ["items", "additionalProperties", "not", "contains"] as const;
const SCHEMA_LIST_KEYS = ["anyOf", "oneOf", "allOf", "prefixItems"] as const;
const VARIANT_LIST_KEYS = ["anyOf", "oneOf"] as const;

function isSchema(value: unknown): value is JsonSchema {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNullSchema(value: unknown): boolean {
  return isSchema(value) && value.type === "null" && Object.keys(value).length === 1;
}

function splitNullableAnyOf(schema: JsonSchema): JsonSchema | null {
  const variants = schema.anyOf;
  if (!Array.isArray(variants) || variants.length !== 2) return null;
  const nonNull = variants.filter((variant) => !isNullSchema(variant));
  if (nonNull.length !== 1 || !isSchema(nonNull[0])) return null;
  return nonNull[0];
}

function withoutKey(schema: JsonSchema, key: string): JsonSchema {
  const { [key]: _removed, ...rest } = schema;
  return rest;
}

function compactNullable(schema: JsonSchema, optional: boolean): JsonSchema {
  let result = schema.default === null ? withoutKey(schema, "default") : schema;
  const inner = splitNullableAnyOf(result);
  if (inner) {
    const outer = withoutKey(result, "anyOf");
    if (optional) {
      // An omitted optional field already means "no value", so the null branch adds nothing.
      result = { ...inner, ...outer };
    } else if (typeof inner.type === "string" && !("enum" in inner) && !("const" in inner)) {
      result = { ...inner, ...outer, type: [inner.type, "null"] };
    }
  }
  if (optional && Array.isArray(result.type) && result.type.includes("null")) {
    const types = result.type.filter((type) => type !== "null");
    result = { ...result, type: types.length === 1 ? types[0] : types };
  }
  return result;
}

function compactChildren(schema: JsonSchema): JsonSchema {
  const result: JsonSchema = { ...schema };
  const required = new Set(Array.isArray(schema.required) ? schema.required : []);
  for (const key of SCHEMA_MAP_KEYS) {
    const map = schema[key];
    if (!isSchema(map)) continue;
    result[key] = Object.fromEntries(Object.entries(map).map(([name, child]) => [
      name,
      isSchema(child) ? compactSchema(child, key === "properties" && !required.has(name)) : child
    ]));
  }
  for (const key of SCHEMA_VALUE_KEYS) {
    const child = schema[key];
    if (isSchema(child)) result[key] = compactSchema(child, false);
  }
  for (const key of SCHEMA_LIST_KEYS) {
    const list = schema[key];
    if (Array.isArray(list)) result[key] = list.map((child) => isSchema(child) ? compactSchema(child, false) : child);
  }
  return result;
}

// A field shared by several variants keeps its description on the first variant only.
function dedupeVariantDescriptions(schema: JsonSchema): JsonSchema {
  const result: JsonSchema = { ...schema };
  for (const key of VARIANT_LIST_KEYS) {
    const variants = schema[key];
    if (!Array.isArray(variants)) continue;
    const seen = new Set<string>();
    result[key] = variants.map((variant) => {
      if (!isSchema(variant) || !isSchema(variant.properties)) return variant;
      const properties = Object.fromEntries(Object.entries(variant.properties).map(([name, property]) => {
        if (!isSchema(property) || typeof property.description !== "string") return [name, property];
        const signature = `${name}\u0000${JSON.stringify(property)}`;
        if (!seen.has(signature)) {
          seen.add(signature);
          return [name, property];
        }
        return [name, withoutKey(property, "description")];
      }));
      return { ...variant, properties };
    });
  }
  return result;
}

function compactSchema(schema: JsonSchema, optional: boolean): JsonSchema {
  return dedupeVariantDescriptions(compactNullable(compactChildren(schema), optional));
}

export function compactToolInputSchema(schema: Record<string, unknown>): Record<string, unknown> {
  return compactSchema(schema, false);
}

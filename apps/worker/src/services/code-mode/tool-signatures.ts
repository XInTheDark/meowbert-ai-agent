import type { FunctionTool } from "openai/resources/responses/responses";

type JsonSchema = Record<string, unknown>;

const MAX_INLINE_DEPTH = 3;

function isSchema(value: unknown): value is JsonSchema {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function schemaTypes(schema: JsonSchema): string[] {
  if (Array.isArray(schema.type)) return schema.type.filter((type): type is string => typeof type === "string");
  return typeof schema.type === "string" ? [schema.type] : [];
}

function isNullable(schema: JsonSchema): boolean {
  return schemaTypes(schema).includes("null")
    || (Array.isArray(schema.anyOf) && schema.anyOf.some((variant) => isSchema(variant) && schemaTypes(variant).includes("null")));
}

function renderType(schema: JsonSchema, depth: number): string {
  if (Array.isArray(schema.enum)) {
    return schema.enum.map((value) => JSON.stringify(value)).join(" | ");
  }
  if (Array.isArray(schema.anyOf)) {
    return schema.anyOf.filter(isSchema).map((variant) => renderType(variant, depth)).join(" | ");
  }

  const rendered = schemaTypes(schema).map((type) => {
    if (type === "integer") return "number";
    if (type === "array") {
      const items = isSchema(schema.items) ? renderType(schema.items, depth) : "unknown";
      return items.includes(" ") ? `Array<${items}>` : `${items}[]`;
    }
    if (type === "object") return renderObject(schema, depth);
    return type;
  });
  return rendered.length > 0 ? rendered.join(" | ") : "unknown";
}

function renderObject(schema: JsonSchema, depth: number): string {
  const properties = isSchema(schema.properties) ? Object.entries(schema.properties).filter(([, value]) => isSchema(value)) : [];
  if (properties.length === 0) return "object";
  if (depth >= MAX_INLINE_DEPTH) return "object";

  const indent = "  ".repeat(depth + 1);
  const lines = properties.map(([name, value]) => {
    const property = value as JsonSchema;
    const optional = isNullable(property) ? "?" : "";
    const description = typeof property.description === "string" ? ` // ${property.description.replace(/\s+/g, " ").trim()}` : "";
    return `${indent}${name}${optional}: ${renderType(property, depth + 1)};${description}`;
  });
  return `{\n${lines.join("\n")}\n${"  ".repeat(depth)}}`;
}

// Nullable fields render as optional because exec fills omitted ones with null.
export function renderToolSignature(tool: FunctionTool): string {
  const description = tool.description ? `// ${tool.description.replace(/\s+/g, " ").trim()}\n` : "";
  const parameters = isSchema(tool.parameters) ? renderObject(tool.parameters, 0) : "object";
  const accessor = /^[A-Za-z_$][\w$]*$/.test(tool.name) ? `tools.${tool.name}` : `tools[${JSON.stringify(tool.name)}]`;
  return `${description}${accessor}(args: ${parameters}): Promise<any>`;
}

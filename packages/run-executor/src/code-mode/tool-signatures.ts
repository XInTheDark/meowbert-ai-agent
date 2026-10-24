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

function toolAccessor(tool: FunctionTool): string {
  return /^[A-Za-z_$][\w$]*$/.test(tool.name) ? `tools.${tool.name}` : `tools[${JSON.stringify(tool.name)}]`;
}

function renderCall(tool: FunctionTool): string {
  const parameters = isSchema(tool.parameters) ? renderObject(tool.parameters, 0) : "object";
  return `${toolAccessor(tool)}(args: ${parameters}): Promise<any>`;
}

function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

// Nullable fields render as optional because exec fills omitted ones with null.
export function renderToolSignature(tool: FunctionTool): string {
  const description = tool.description ? `// ${collapseWhitespace(tool.description)}\n` : "";
  return `${description}${renderCall(tool)}`;
}

// The full form search_tools returns: the description keeps its own line breaks.
export function renderToolDocumentation(tool: FunctionTool): string {
  const lines = tool.description?.trim().split("\n").map((line) => `// ${line.trimEnd()}`.trimEnd()) ?? [];
  return [...lines, renderCall(tool)].join("\n");
}

const SUMMARY_MAX_CHARS = 140;

// The first sentence of a tool's description, for listings that skip the arguments.
export function summarizeTool(tool: FunctionTool): string {
  const description = collapseWhitespace(tool.description ?? "");
  const firstSentence = description.match(/^.*?[.!?](?=\s|$)/)?.[0] ?? description;
  return firstSentence.length > SUMMARY_MAX_CHARS ? `${firstSentence.slice(0, SUMMARY_MAX_CHARS - 1)}…` : firstSentence;
}

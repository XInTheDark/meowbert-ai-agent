import type { Tool } from "openai/resources/responses/responses";
import type { PlatformModelType } from "@meowbert/shared";
import { applyPatchFunctionToolDefinition } from "./apply-patch.js";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeNullableAnyOfSchema(schema: Record<string, unknown>): Record<string, unknown> | null {
  const variants = Array.isArray(schema.anyOf) ? schema.anyOf : null;
  if (!variants || variants.length !== 2 || !variants.every(isPlainObject)) {
    return null;
  }

  const nullVariant = variants.find((variant) => variant.type === "null");
  const valueVariant = variants.find((variant) => variant.type !== "null");
  if (!nullVariant || !valueVariant || typeof valueVariant.type !== "string") {
    return null;
  }

  const { anyOf: _anyOf, ...base } = schema;
  return {
    ...base,
    ...valueVariant,
    type: [valueVariant.type, "null"]
  };
}

function normalizeGoogleJsonSchema(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => normalizeGoogleJsonSchema(entry));
  }

  if (!isPlainObject(value)) {
    return value;
  }

  const normalizedAnyOf = normalizeNullableAnyOfSchema(value);
  const source = normalizedAnyOf ?? value;
  const output: Record<string, unknown> = {};

  for (const [key, entry] of Object.entries(source)) {
    if (key === "$schema" || key === "anyOf") {
      continue;
    }
    output[key] = normalizeGoogleJsonSchema(entry);
  }

  return output;
}

function normalizeGoogleTool(tool: Tool): Tool | null {
  const toolRecord = tool as unknown as Record<string, unknown>;
  if (toolRecord.type === "custom" && toolRecord.name === "apply_patch") {
    return applyPatchFunctionToolDefinition as Tool;
  }

  if (toolRecord.type !== "function") {
    return tool;
  }

  const name = typeof toolRecord.name === "string" ? toolRecord.name.replaceAll(".", "_") : toolRecord.name;
  return {
    ...toolRecord,
    ...(typeof name === "string" ? { name } : {}),
    parameters: normalizeGoogleJsonSchema(toolRecord.parameters)
  } as unknown as Tool;
}

export function normalizeProviderRequestTools(tools: Tool[], modelType: PlatformModelType): Tool[] {
  if (modelType !== "google") {
    return tools;
  }

  return tools.flatMap((tool) => {
    const normalized = normalizeGoogleTool(tool);
    return normalized ? [normalized] : [];
  });
}

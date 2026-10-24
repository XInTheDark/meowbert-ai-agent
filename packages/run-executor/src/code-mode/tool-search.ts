import type { FunctionTool } from "openai/resources/responses/responses";
import type { SearchToolsArguments } from "./search-tools-tool.js";
import { groupColdTools, normalizeGroupId } from "./tool-catalog.js";
import { renderToolDocumentation, summarizeTool } from "./tool-signatures.js";

// A search across every tool stops here; a search within one group returns every match.
const MAX_RESULTS_ACROSS_GROUPS = 20;

type ToolEntry = { name: string; summary: string } | { name: string; documentation: string };

export type ToolSearchResult =
  | { groups: Array<{ group: string; tools: number }>; note: string }
  | { tools: ToolEntry[]; not_found?: string[] }
  | { error: string; groups: string[] };

const SKILLS_NOTE = "Skills that are not loaded yet are not listed; find them with list_skills and load one with enable_skill.";

function words(text: string): string[] {
  return text.toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length > 1);
}

function parameterNames(tool: FunctionTool): string[] {
  const properties = (tool.parameters as { properties?: Record<string, unknown> } | null)?.properties;
  return properties ? Object.keys(properties) : [];
}

// Name matches count most, then parameter names, then the description.
function scoreTool(tool: FunctionTool, queryWords: string[]): number {
  const nameWords = new Set(words(tool.name));
  const parameterWords = new Set(parameterNames(tool).flatMap(words));
  const descriptionWords = new Set(words(tool.description ?? ""));
  return queryWords.reduce((score, word) => score
    + (nameWords.has(word) ? 3 : 0)
    + (parameterWords.has(word) ? 1 : 0)
    + (descriptionWords.has(word) ? 1 : 0), 0);
}

function rankByQuery(tools: FunctionTool[], query: string): FunctionTool[] {
  const queryWords = words(query);
  return tools
    .map((tool) => ({ tool, score: scoreTool(tool, queryWords) }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score)
    .map((entry) => entry.tool);
}

function describe(tools: FunctionTool[], fullDocs: boolean): ToolEntry[] {
  return tools.map((tool) => fullDocs
    ? { name: tool.name, documentation: renderToolDocumentation(tool) }
    : { name: tool.name, summary: summarizeTool(tool) });
}

function findByName(tools: FunctionTool[], names: string[], fullDocs: boolean): ToolSearchResult {
  const byName = new Map(tools.map((tool) => [tool.name, tool]));
  const notFound = names.filter((name) => !byName.has(name));
  return {
    tools: describe(names.flatMap((name) => byName.get(name) ?? []), fullDocs),
    ...(notFound.length > 0 ? { not_found: notFound } : {})
  };
}

// `tools` is everything exec can call this turn. Names and queries reach all of them; groups cover
// the cold tools exec lists only by name.
export function searchTools(tools: FunctionTool[], args: SearchToolsArguments): ToolSearchResult {
  if (args.names && args.names.length > 0) {
    return findByName(tools, args.names, args.full_docs ?? true);
  }

  const fullDocs = args.full_docs ?? false;
  const groups = groupColdTools(tools);
  const groupId = args.group?.trim() ? normalizeGroupId(args.group) : null;
  const group = groupId ? groups.find((entry) => entry.id === groupId) : undefined;
  if (groupId && !group) {
    return { error: `Unknown group: ${args.group}`, groups: groups.map((entry) => entry.id) };
  }

  const query = args.query?.trim();
  if (query) {
    const matches = group ? rankByQuery(group.tools, query) : rankByQuery(tools, query).slice(0, MAX_RESULTS_ACROSS_GROUPS);
    return { tools: describe(matches, fullDocs) };
  }
  if (group) {
    return { tools: describe(group.tools, fullDocs) };
  }
  return { groups: groups.map((entry) => ({ group: entry.id, tools: entry.tools.length })), note: SKILLS_NOTE };
}

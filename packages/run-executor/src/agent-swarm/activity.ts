import type { ResponseOutputItem } from "openai/resources/responses/responses";

// Models under-report what they are doing, so the notes that stop siblings duplicating work are
// recorded by the runtime: files a lane wrote, searches it ran and pages it opened. Shell commands
// are not inspected.
export interface SwarmActivity {
  wrote: string[];
  searched: string[];
  opened: string[];
}

const MAX_LISTED = 6;

export function createSwarmActivity(): SwarmActivity {
  return { wrote: [], searched: [], opened: [] };
}

function addUnique(target: string[], values: string[]): void {
  for (const value of values) {
    const trimmed = value.trim();
    if (trimmed && !target.includes(trimmed)) target.push(trimmed);
  }
}

export function recordFilesWritten(activity: SwarmActivity, paths: string[]): void {
  addUnique(activity.wrote, paths);
}

export function recordSearchQuery(activity: SwarmActivity, searchQuery: string): void {
  addUnique(activity.searched, [searchQuery]);
}

// Hosted web search reports what it did as an action: a search, or a page it opened or searched in.
export function recordWebSearchCall(activity: SwarmActivity, item: ResponseOutputItem): void {
  if (item.type !== "web_search_call") return;
  const action = (item as { action?: { type?: string; query?: unknown; queries?: unknown; url?: unknown } }).action;
  if (!action) return;
  if (action.type === "search") {
    const queries = Array.isArray(action.queries) ? action.queries : [action.query];
    addUnique(activity.searched, queries.filter((value): value is string => typeof value === "string"));
  } else if (typeof action.url === "string") {
    addUnique(activity.opened, [action.url]);
  }
}

function listed(values: string[], format: (value: string) => string = (value) => value): string {
  const shown = values.slice(0, MAX_LISTED).map(format).join(", ");
  return values.length > MAX_LISTED ? `${shown}, ...` : shown;
}

function hostOf(url: string): string {
  try {
    return new URL(url).host || url;
  } catch {
    return url;
  }
}

export function formatActivityNotes(activity: SwarmActivity): string[] {
  const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;
  return [
    activity.wrote.length ? `wrote ${plural(activity.wrote.length, "file")} (${listed(activity.wrote)})` : null,
    activity.searched.length ? `searched for ${listed(activity.searched, (value) => `"${value}"`)}` : null,
    activity.opened.length ? `opened ${plural(activity.opened.length, "page")} (${listed(activity.opened, hostOf)})` : null
  ].filter((note): note is string => note !== null);
}

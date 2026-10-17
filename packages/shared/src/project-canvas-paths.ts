export const PROJECT_CANVASES_DIR = "canvases";
export const DEFAULT_CANVAS_ENTRY_PATH = "index.html";

export function slugifyCanvasName(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return slug || "canvas";
}

/** Slug candidates in the order they should be tried: `name`, `name-2`, `name-3`, ... */
export function listCanvasSlugCandidates(name: string, count = 100): string[] {
  const base = slugifyCanvasName(name);
  return Array.from({ length: count }, (_value, index) => index === 0 ? base : `${base}-${index + 1}`);
}

/** A forward-slash path inside the canvas directory, or the default entry for anything unsafe. */
export function normalizeCanvasEntryPath(value: string | null | undefined): string {
  const trimmed = (value ?? "").trim().replace(/\\/g, "/").replace(/^\.\//, "");
  if (!trimmed || trimmed.startsWith("/") || trimmed.split("/").includes("..")) {
    return DEFAULT_CANVAS_ENTRY_PATH;
  }
  return trimmed;
}

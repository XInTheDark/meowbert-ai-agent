// The on-disk format of an index entry: a short header recording what the entry covers and how each
// source looked when it was read, then the summary as free markdown. Each source sits on one JSON
// line so the header stays readable and still parses exactly.
//
// ---
// indexed_at: 2026-10-28T10:41:00.000Z
// sources:
//   - {"path":"context/specs/api.yaml","kind":"file","mtime":"2026-10-20T09:12:03.000Z","size":18233}
// ---

export interface IndexSourceStamp {
  path: string;
  kind: "file" | "folder";
  mtime: string;
  // Files only: a folder's size says nothing about its contents.
  size: number | null;
}

export interface IndexEntry {
  indexedAt: string;
  sources: IndexSourceStamp[];
  body: string;
}

const FENCE = "---";
const INDEXED_AT_PREFIX = "indexed_at:";
const SOURCE_PREFIX = "  - ";

export function serializeIndexEntry(entry: IndexEntry): string {
  return [
    FENCE,
    `${INDEXED_AT_PREFIX} ${entry.indexedAt}`,
    "sources:",
    ...entry.sources.map((source) => SOURCE_PREFIX + JSON.stringify(source)),
    FENCE,
    "",
    entry.body.trim(),
    ""
  ].join("\n");
}

function parseSourceStamp(line: string): IndexSourceStamp | null {
  try {
    const value = JSON.parse(line.slice(SOURCE_PREFIX.length)) as Partial<IndexSourceStamp>;
    if (typeof value.path !== "string" || typeof value.mtime !== "string") return null;
    if (value.kind !== "file" && value.kind !== "folder") return null;
    return { path: value.path, kind: value.kind, mtime: value.mtime, size: typeof value.size === "number" ? value.size : null };
  } catch {
    return null;
  }
}

// Returns null when the header is missing or was edited out of shape.
export function parseIndexEntry(text: string): IndexEntry | null {
  const lines = text.split(/\r?\n/);
  if (lines[0]?.trim() !== FENCE) return null;
  const end = lines.indexOf(FENCE, 1);
  if (end < 0) return null;

  let indexedAt: string | null = null;
  const sources: IndexSourceStamp[] = [];
  for (const line of lines.slice(1, end)) {
    if (line.startsWith(INDEXED_AT_PREFIX)) indexedAt = line.slice(INDEXED_AT_PREFIX.length).trim();
    else if (line.startsWith(SOURCE_PREFIX)) {
      const source = parseSourceStamp(line);
      if (!source) return null;
      sources.push(source);
    }
  }
  if (!indexedAt || sources.length === 0) return null;
  return { indexedAt, sources, body: lines.slice(end + 1).join("\n").trim() };
}

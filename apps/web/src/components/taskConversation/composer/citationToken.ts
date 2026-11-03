export interface Citation {
  label: string;
  path: string;
}

export type CitationSegment =
  | { kind: "text"; text: string }
  | { kind: "citation"; citation: Citation };

const CITATION_PATTERN = /\[((?:\\.|[^\]\\\n])+)\]\((?:<([^<>\n]+)>|([^\s()<>]+))\)/g;
const UNSAFE_LINK_PATH = /[\s()]/;

function escapeLabel(label: string): string {
  return label.replace(/[\\[\]]/g, "\\$&");
}

function unescapeLabel(label: string): string {
  return label.replace(/\\(.)/g, "$1");
}

// A citation is an ordinary Markdown link, so it survives drafts, editing and copying as plain text.
export function buildCitationToken(citation: Citation): string {
  const target = UNSAFE_LINK_PATH.test(citation.path) ? `<${citation.path}>` : citation.path;
  return `[${escapeLabel(citation.label)}](${target})`;
}

export function isTaskInputPath(path: string): boolean {
  return path.startsWith("inputs/") && !path.split("/").includes("..");
}

export function parseCitationSegments(text: string, isCitablePath: (path: string) => boolean = isTaskInputPath): CitationSegment[] {
  const segments: CitationSegment[] = [];
  let cursor = 0;
  for (const match of text.matchAll(CITATION_PATTERN)) {
    const path = match[2] ?? match[3];
    if (!isCitablePath(path)) continue;
    if (match.index > cursor) segments.push({ kind: "text", text: text.slice(cursor, match.index) });
    segments.push({ kind: "citation", citation: { label: unescapeLabel(match[1]), path } });
    cursor = match.index + match[0].length;
  }
  if (cursor < text.length) segments.push({ kind: "text", text: text.slice(cursor) });
  return segments;
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function citationTextToHtml(text: string, isCitablePath?: (path: string) => boolean): string {
  return parseCitationSegments(text, isCitablePath)
    .map((segment) => segment.kind === "text"
      ? escapeHtml(segment.text).replace(/\n/g, "<br>")
      : `<a href="${escapeHtml(segment.citation.path)}">${escapeHtml(segment.citation.label)}</a>`)
    .join("");
}

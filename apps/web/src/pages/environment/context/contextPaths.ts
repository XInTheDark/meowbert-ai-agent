// Context files live under the project's "context/" folder; the page shows paths relative to it.
export function stripContextPrefix(relativePath: string | null | undefined): string {
  if (!relativePath || relativePath === "context") {
    return "";
  }
  return relativePath.startsWith("context/") ? relativePath.slice("context/".length) : relativePath;
}

export function buildContextSourceNoteFilename(label: string, index: number): string {
  const fallback = `source-note-${index + 1}.txt`;
  const basename = label.trim().split(/[\\/]/).pop() ?? "";
  const sanitized = basename
    .replace(/[<>:"|?*\u0000-\u001f]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\.+$/, "");

  if (!sanitized) {
    return fallback;
  }

  return /\.[A-Za-z0-9]{1,10}$/.test(sanitized) ? sanitized : `${sanitized}.txt`;
}

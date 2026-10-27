/** Maps a frame's current URL back to a file within its original preview root. */
export function resolveCanvasDocumentPath(src: string, entryPath: string, href: string): string | null {
  try {
    const initial = new URL(src, window.location.href);
    const current = new URL(href);
    const entry = entryPath.split("/").map((segment) => segment.trim()).filter((segment) => segment && segment !== ".");
    const suffix = entry.map(encodeURIComponent).join("/");
    if (!suffix || !initial.pathname.endsWith(`/${suffix}`)) return null;
    const root = initial.pathname.slice(0, -suffix.length);
    if (current.protocol !== initial.protocol || current.host !== initial.host || !current.pathname.startsWith(root)) return null;
    const segments = current.pathname.slice(root.length).split("/").map(decodeURIComponent);
    if (segments.some((segment) => !segment || segment === "." || segment === ".." || /[\/\\\0]/.test(segment))) return null;
    return segments.join("/");
  } catch {
    return null;
  }
}

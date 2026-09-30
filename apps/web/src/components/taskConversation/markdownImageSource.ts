const URL_SCHEME_PATTERN = /^[a-z][a-z0-9+.-]*:/i;

export type BuildInlineFileUrl = (relativePath: string) => string | null;

export type MarkdownImageSource =
  | { kind: "external"; src: string | undefined }
  | { kind: "task-file"; src: string | null };

// Agents write outputs into the task's own folder and often embed them by bare
// relative path, e.g. `![Chart](weekly_summary.png)`. Resolve those against the
// task folder through the inline file route; leave every other source untouched.
export function resolveTaskRelativeImagePath(src: string | undefined): string | null {
  const trimmed = src?.trim();
  if (!trimmed || URL_SCHEME_PATTERN.test(trimmed) || /^[/\\#?]/.test(trimmed)) {
    return null;
  }

  const pathOnly = trimmed.split(/[?#]/, 1)[0];
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathOnly);
  } catch {
    return null;
  }

  const segments = decoded.split("/").filter((segment) => segment.length > 0 && segment !== ".");
  if (segments.length === 0 || segments.some((segment) => segment === ".." || segment.includes("\\"))) {
    return null;
  }

  return segments.join("/");
}

export function resolveMarkdownImageSource(
  src: string | undefined,
  buildInlineFileUrl: BuildInlineFileUrl | null
): MarkdownImageSource {
  const relativePath = buildInlineFileUrl ? resolveTaskRelativeImagePath(src) : null;
  if (!buildInlineFileUrl || relativePath === null) {
    return { kind: "external", src };
  }

  return { kind: "task-file", src: buildInlineFileUrl(relativePath) };
}

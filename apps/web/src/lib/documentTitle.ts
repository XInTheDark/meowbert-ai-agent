import { useEffect } from "react";

const APP_TITLE = "Meowbert AI";

function normalizeTitlePart(part: string | null | undefined): string | null {
  if (typeof part !== "string") {
    return null;
  }

  const trimmed = part.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function buildDocumentTitle(...parts: Array<string | null | undefined>): string {
  const normalized = parts
    .map(normalizeTitlePart)
    .filter((part): part is string => part !== null);

  return normalized.length > 0 ? `${normalized.join(" · ")} · ${APP_TITLE}` : APP_TITLE;
}

export function useDocumentTitle(...parts: Array<string | null | undefined>): void {
  // Depend on the joined title: callers pass a varying number of parts, and a dependency
  // array that changes length between renders is invalid in React.
  const title = buildDocumentTitle(...parts);
  useEffect(() => {
    if (typeof document === "undefined") {
      return;
    }

    document.title = title;
  }, [title]);
}

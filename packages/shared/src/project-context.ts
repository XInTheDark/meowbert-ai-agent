const PROJECT_CONTEXT_PAYLOAD_KEY = "project_context";
const PROJECT_CONTEXT_NOTES_KEY = "notes";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function clonePayload(payload: Record<string, unknown>): Record<string, unknown> {
  return { ...payload };
}

function asResponsesPayload(payload: Record<string, unknown> | null | undefined): Record<string, unknown> {
  return payload && isPlainObject(payload.responses)
    ? payload.responses as Record<string, unknown>
    : {};
}

function normalizeOptionalString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizePathSegment(segment: string): string {
  return segment.trim();
}

export function normalizeProjectContextPath(relativePath: string): string {
  return relativePath
    .split(/[/\\]+/)
    .map(normalizePathSegment)
    .filter((segment) => segment.length > 0 && segment !== ".")
    .join("/");
}

export function buildProjectContextPath(relativePath = ""): string {
  const normalized = normalizeProjectContextPath(relativePath);
  return normalized.length > 0 ? `context/${normalized}` : "context";
}

export function isProjectContextPath(relativePath: string): boolean {
  const normalized = normalizeProjectContextPath(relativePath);
  return normalized === "context" || normalized.startsWith("context/");
}

function getProjectContextPayloads(
  payload: Record<string, unknown> | null | undefined
): Record<string, unknown>[] {
  if (!payload) {
    return [];
  }

  const projectContexts: Record<string, unknown>[] = [];
  const responsesPayload = asResponsesPayload(payload);
  if (isPlainObject(responsesPayload[PROJECT_CONTEXT_PAYLOAD_KEY])) {
    projectContexts.push(responsesPayload[PROJECT_CONTEXT_PAYLOAD_KEY] as Record<string, unknown>);
  }

  if (isPlainObject(payload[PROJECT_CONTEXT_PAYLOAD_KEY])) {
    projectContexts.push(payload[PROJECT_CONTEXT_PAYLOAD_KEY] as Record<string, unknown>);
  }

  return projectContexts;
}

function asProjectContext(payload: Record<string, unknown> | null | undefined): Record<string, unknown> {
  const projectContexts = getProjectContextPayloads(payload);
  return projectContexts[projectContexts.length - 1] ?? {};
}

function stripLegacyNestedProjectContext(payload: Record<string, unknown>): Record<string, unknown> {
  const responsesPayload = asResponsesPayload(payload);
  if (!isPlainObject(responsesPayload[PROJECT_CONTEXT_PAYLOAD_KEY])) {
    return clonePayload(payload);
  }

  const normalized = clonePayload(payload);
  const nextResponsesPayload = { ...responsesPayload };
  delete nextResponsesPayload[PROJECT_CONTEXT_PAYLOAD_KEY];

  if (Object.keys(nextResponsesPayload).length === 0) {
    delete normalized.responses;
  } else {
    normalized.responses = nextResponsesPayload;
  }

  return normalized;
}

export function getProjectContextNotes(
  payload: Record<string, unknown> | null | undefined
): Record<string, string> {
  const normalizedEntries = getProjectContextPayloads(payload)
    .flatMap((projectContext) => {
      const rawNotes = projectContext[PROJECT_CONTEXT_NOTES_KEY];
      if (!isPlainObject(rawNotes)) {
        return [];
      }

      return Object.entries(rawNotes)
        .map(([relativePath, note]) => {
          const normalizedPath = normalizeProjectContextPath(relativePath);
          const normalizedNote = normalizeOptionalString(note);
          if (!normalizedPath || !normalizedNote) {
            return null;
          }

          return [normalizedPath, normalizedNote] as const;
        })
        .filter((entry): entry is readonly [string, string] => Array.isArray(entry));
    });

  return Object.fromEntries(normalizedEntries);
}

export function getProjectContextNote(
  payload: Record<string, unknown> | null | undefined,
  relativePath: string
): string | null {
  const normalizedPath = normalizeProjectContextPath(relativePath);
  if (!normalizedPath) {
    return null;
  }

  return getProjectContextNotes(payload)[normalizedPath] ?? null;
}

export function setProjectContextNote(
  payload: Record<string, unknown>,
  relativePath: string,
  note: string | null
): Record<string, unknown> {
  const normalizedPath = normalizeProjectContextPath(relativePath);
  if (!normalizedPath) {
    return clonePayload(payload);
  }

  const normalized = stripLegacyNestedProjectContext(payload);
  const projectContext = { ...asProjectContext(normalized) };
  const notes = { ...getProjectContextNotes(payload) };
  const normalizedNote = normalizeOptionalString(note);

  if (normalizedNote) {
    notes[normalizedPath] = normalizedNote;
  } else {
    delete notes[normalizedPath];
  }

  if (Object.keys(notes).length === 0) {
    delete projectContext[PROJECT_CONTEXT_NOTES_KEY];
  } else {
    projectContext[PROJECT_CONTEXT_NOTES_KEY] = notes;
  }

  if (Object.keys(projectContext).length === 0) {
    delete normalized[PROJECT_CONTEXT_PAYLOAD_KEY];
  } else {
    normalized[PROJECT_CONTEXT_PAYLOAD_KEY] = projectContext;
  }

  return normalized;
}

export function removeProjectContextNotes(
  payload: Record<string, unknown>,
  relativePaths: string[]
): Record<string, unknown> {
  let nextPayload = clonePayload(payload);
  for (const relativePath of relativePaths) {
    nextPayload = setProjectContextNote(nextPayload, relativePath, null);
  }
  return nextPayload;
}

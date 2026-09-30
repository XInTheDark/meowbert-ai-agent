export interface InlineArtifact {
  type: "html" | "image" | "mermaid";
  relativePath: string;
  title: string | null;
  description: string | null;
  width: number | null;
  height: number | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function parseMaybeJson(raw: string): unknown | null {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

function extractInlineArtifactEnvelope(value: unknown): unknown {
  if (typeof value === "string") {
    const parsed = parseMaybeJson(value);
    return parsed === null ? null : extractInlineArtifactEnvelope(parsed);
  }

  if (!isRecord(value)) {
    return null;
  }

  if (Array.isArray(value.content)) {
    const textItem = value.content.find((item) => isRecord(item) && item.type === "text" && typeof item.text === "string");
    if (textItem && typeof textItem.text === "string") {
      return extractInlineArtifactEnvelope(textItem.text);
    }
  }

  if (isRecord(value.inline_artifact)) {
    return value.inline_artifact;
  }

  return value;
}

export function parseInlineArtifact(value: unknown): InlineArtifact | null {
  const artifact = extractInlineArtifactEnvelope(value);
  if (!isRecord(artifact)) {
    return null;
  }

  const type = asString(artifact.type);
  const relativePath = asString(artifact.relative_path) ?? asString(artifact.relativePath);
  if (!isInlineArtifactType(type) || !relativePath || relativePath.trim().length === 0) {
    return null;
  }

  const title = asString(artifact.title)?.trim() ?? null;
  const description = asString(artifact.description)?.trim() ?? null;
  const rawWidth = asNumber(artifact.width) ?? asNumber(artifact.width_px);
  const rawHeight = asNumber(artifact.height) ?? asNumber(artifact.height_px);

  return {
    type,
    relativePath: relativePath.trim().replace(/^\/+/, ""),
    title: title && title.length > 0 ? title : null,
    description: description && description.length > 0 ? description : null,
    width: rawWidth !== null ? Math.max(320, Math.min(2000, Math.round(rawWidth))) : null,
    height: rawHeight !== null ? Math.max(240, Math.min(1600, Math.round(rawHeight))) : null
  };
}

function isInlineArtifactType(value: string | null): value is InlineArtifact["type"] {
  return value === "html" || value === "image" || value === "mermaid";
}

export function serializeInlineArtifact(artifact: InlineArtifact): Record<string, unknown> {
  return {
    type: artifact.type,
    relative_path: artifact.relativePath,
    ...(artifact.title !== null ? { title: artifact.title } : {}),
    ...(artifact.description !== null ? { description: artifact.description } : {}),
    ...(artifact.width !== null ? { width: artifact.width } : {}),
    ...(artifact.height !== null ? { height: artifact.height } : {})
  };
}

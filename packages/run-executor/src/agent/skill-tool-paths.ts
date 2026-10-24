import path from "node:path";

const PATH_LIKE_FIELD_PATTERN = /(?:^|_)(?:path|paths|dir|dirs|file|files|filename|filenames|file_name|file_names)$/i;
const URI_SCHEME_PATTERN = /^[a-zA-Z][a-zA-Z\d+.-]*:\/\//;
const WINDOWS_DRIVE_PATTERN = /^[A-Za-z]:[\\/]/;
const WINDOWS_UNC_PATTERN = /^\\\\/;

function isPathLikeField(fieldName: string | null): boolean {
  return typeof fieldName === "string" && PATH_LIKE_FIELD_PATTERN.test(fieldName);
}

function isRelativeFilesystemPath(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed || trimmed.startsWith("~")) {
    return false;
  }
  if (URI_SCHEME_PATTERN.test(trimmed) || WINDOWS_DRIVE_PATTERN.test(trimmed) || WINDOWS_UNC_PATTERN.test(trimmed)) {
    return false;
  }
  return !path.isAbsolute(trimmed);
}

function normalizeSkillToolArgumentValue(
  value: unknown,
  cwd: string,
  fieldName: string | null
): unknown {
  if (typeof value === "string" && isPathLikeField(fieldName) && isRelativeFilesystemPath(value)) {
    return path.resolve(cwd, value);
  }

  if (Array.isArray(value)) {
    return value.map((entry) => normalizeSkillToolArgumentValue(entry, cwd, fieldName));
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [key, normalizeSkillToolArgumentValue(entry, cwd, key)])
  );
}

export function normalizeSkillToolArguments(
  args: Record<string, unknown>,
  cwd: string
): Record<string, unknown> {
  return normalizeSkillToolArgumentValue(args, path.resolve(cwd), null) as Record<string, unknown>;
}

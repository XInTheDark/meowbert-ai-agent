import path from "node:path";

const PREFIX = "/meowbert-host";

// Host filesystem operations retain native paths; containers always receive Linux paths.
export function toSandboxPath(value: string, platform: string = process.platform): string {
  if (platform !== "win32") return value;
  const unc = value.startsWith("\\\\") || value.startsWith("//");
  const normalized = value.replace(/\\+/g, "/");
  const drive = /^([a-z]):\//i.exec(normalized);
  if (drive) return PREFIX + "/drives/" + drive[1].toLowerCase() + "/" + normalized.slice(3);
  if (unc) return PREFIX + "/unc/" + normalized.replace(/^\/+/, "");
  return value;
}

export function fromSandboxPath(value: string, platform: string = process.platform): string {
  if (platform !== "win32") return value;
  const drive = /^\/meowbert-host\/drives\/([a-z])(?:\/|$)/i.exec(value);
  if (drive) return path.win32.normalize(drive[1].toUpperCase() + ":/" + value.slice(drive[0].length));
  if (value.startsWith(PREFIX + "/unc/")) return path.win32.normalize("//" + value.slice((PREFIX + "/unc/").length));
  return value;
}

// Generated scripts may embed native paths in JSON, quotes or patch headers. Translate
// rooted Windows paths without touching shell escapes elsewhere in the script.
export function toSandboxText(value: string, platform: string = process.platform): string {
  if (platform !== "win32") return value;
  return value.replace(/[a-z]:[\\/][^\n\r"'`<>]*/gi, (match) => toSandboxPath(match, platform))
    .replace(/(^|[\s"'`])(\\{2,}[a-z0-9._-]+(?:\\+[^\\/\n\r"'`<>]+)+)/gi,
      (_match, prefix: string, value: string) => prefix + toSandboxPath(value, platform));
}

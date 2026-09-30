import fs from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";

const BUILD_INFO_PATH = process.env.MEOWBERT_OFFICE_BUILD_INFO_PATH || "/app/build-meta/office.json";

function parseBoolean(value) {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return null;
  }
  if (["1", "true", "yes", "on", "enabled"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "off", "disabled"].includes(normalized)) {
    return false;
  }

  throw new Error(
    `Unsupported office toggle value "${value}". Use true/false, 1/0, yes/no, on/off, or leave it unset.`
  );
}

function resolveConfigPath() {
  if (process.env.MEOWBERT_CONFIG_PATH) {
    return process.env.MEOWBERT_CONFIG_PATH;
  }

  const candidates = [
    path.resolve(process.cwd(), "config/global.json"),
    path.resolve(process.cwd(), "config/global.docker.json"),
    path.resolve(process.cwd(), "../config/global.json"),
    path.resolve(process.cwd(), "../config/global.docker.json"),
    path.resolve(process.cwd(), "../../config/global.json"),
    path.resolve(process.cwd(), "../../config/global.docker.json")
  ];

  return candidates.find((candidate) => fs.existsSync(candidate)) ?? null;
}

function resolveRuntimeEnabled() {
  const inlineConfig = process.env.MEOWBERT_CONFIG_JSON;
  if (inlineConfig) {
    const parsed = JSON.parse(inlineConfig);
    return parsed?.skills?.office?.enabled !== false;
  }

  const inlineConfigBase64 = process.env.MEOWBERT_CONFIG_BASE64;
  if (inlineConfigBase64) {
    const raw = Buffer.from(inlineConfigBase64, "base64").toString("utf-8");
    const parsed = JSON.parse(raw);
    return parsed?.skills?.office?.enabled !== false;
  }

  const explicitOverride = parseBoolean(process.env.MEOWBERT_OFFICE_ENABLED);
  if (explicitOverride !== null) {
    return explicitOverride;
  }

  const configPath = resolveConfigPath();
  if (!configPath) {
    return true;
  }

  const parsed = JSON.parse(fs.readFileSync(configPath, "utf-8"));
  return parsed?.skills?.office?.enabled !== false;
}

function resolveCommand(command) {
  const result = spawnSync("bash", ["-lc", command], {
    encoding: "utf-8",
    env: process.env
  });
  if (result.status !== 0) {
    return null;
  }

  const resolved = result.stdout.trim().split(/\r?\n/, 1)[0];
  return resolved || null;
}

function resolveOfficeBinaryPath() {
  const configuredBinary = process.env.LIBREOFFICE_BIN;
  if (configuredBinary) {
    if (path.isAbsolute(configuredBinary) && fs.existsSync(configuredBinary)) {
      return configuredBinary;
    }

    const resolvedConfiguredBinary = resolveCommand("command -v \"$LIBREOFFICE_BIN\"");
    if (resolvedConfiguredBinary) {
      return resolvedConfiguredBinary;
    }
  }

  return resolveCommand("command -v soffice || command -v libreoffice");
}

const runtimeEnabled = resolveRuntimeEnabled();
const buildInfo = fs.existsSync(BUILD_INFO_PATH)
  ? JSON.parse(fs.readFileSync(BUILD_INFO_PATH, "utf-8"))
  : { officeEnabled: false, source: "missing-build-info" };
const buildEnabled = buildInfo?.officeEnabled === true;
const officeBinaryPath = resolveOfficeBinaryPath();
const officeBinaryPresent = officeBinaryPath !== null && fs.existsSync(officeBinaryPath);

if (runtimeEnabled && !officeBinaryPresent) {
  const reason = buildEnabled
    ? "bundled LibreOffice files are missing"
    : `worker image was built with office disabled (${buildInfo.source ?? "unknown"}) and no custom LibreOffice binary was found`;
  console.error(
    `[entrypoint] Office tools are enabled in server config but ${reason}. Rebuild the worker image after updating config, or install LibreOffice and set LIBREOFFICE_BIN.`
  );
  process.exit(1);
}

if (runtimeEnabled && !buildEnabled && officeBinaryPresent) {
  console.warn(
    `[entrypoint] Office tools are enabled in server config, but this image was built without the bundled LibreOffice layer (${buildInfo.source ?? "unknown"}). Falling back to ${officeBinaryPath}.`
  );
}

if (!runtimeEnabled && buildEnabled) {
  console.warn(
    `[entrypoint] Office tools are disabled in server config, but this image still includes bundled LibreOffice from ${buildInfo.source ?? "unknown"}. Rebuild the worker image to remove it.`
  );
}

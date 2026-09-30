import fs from "node:fs";
import path from "node:path";

const OUTPUT_PATH = process.env.MEOWBERT_OFFICE_BUILD_INFO_PATH || "/tmp/office-build.json";
const CONFIG_ROOT = process.env.MEOWBERT_OFFICE_CONFIG_ROOT || "/tmp/build-config";

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
    `Unsupported MEOWBERT_OFFICE_ENABLED value "${value}". Use true/false, 1/0, yes/no, on/off, or leave it unset.`
  );
}

function readEnabledFromConfig(configPath) {
  const raw = JSON.parse(fs.readFileSync(configPath, "utf-8"));
  return {
    enabled: raw?.skills?.office?.enabled !== false,
    source: configPath
  };
}

function resolveFromConfigFiles() {
  const candidates = [
    "global.docker.json",
    "global.json",
    "global.example.json"
  ].map((filename) => path.join(CONFIG_ROOT, filename));

  for (const candidate of candidates) {
    if (!fs.existsSync(candidate)) {
      continue;
    }
    return readEnabledFromConfig(candidate);
  }

  return {
    enabled: true,
    source: "default"
  };
}

const override = parseBoolean(process.env.MEOWBERT_OFFICE_ENABLED);
const resolved = override === null
  ? resolveFromConfigFiles()
  : {
      enabled: override,
      source: "MEOWBERT_OFFICE_ENABLED"
    };

fs.writeFileSync(OUTPUT_PATH, JSON.stringify({
  officeEnabled: resolved.enabled,
  source: resolved.source
}, null, 2));

console.log(
  `[office-build] ${resolved.enabled ? "enabled" : "disabled"} via ${resolved.source}`
);

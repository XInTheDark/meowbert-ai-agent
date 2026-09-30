import { execFile } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";

const execFileAsync = promisify(execFile);
const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DESKTOP_WORKSPACE_PATH = "apps/desktop";
const DESKTOP_VERSION_PATHS = [
  `${DESKTOP_WORKSPACE_PATH}/package.json`,
  "package-lock.json"
];
const DEFAULT_PACKAGE_PATH = path.join(REPOSITORY_ROOT, DESKTOP_WORKSPACE_PATH, "package.json");
const DEFAULT_LOCK_PATH = path.join(REPOSITORY_ROOT, "package-lock.json");

function parseJson(content, label) {
  try {
    return JSON.parse(content);
  } catch {
    throw new Error(`${label} is not valid JSON.`);
  }
}

function isValidSemver(version) {
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([^+]+))?(?:\+(.+))?$/.exec(version);
  if (!match) {
    return false;
  }

  const prereleaseIdentifiers = match[4]?.split(".") ?? [];
  const buildIdentifiers = match[5]?.split(".") ?? [];
  const validIdentifier = (identifier) => /^[0-9A-Za-z-]+$/.test(identifier);
  const validPrereleaseIdentifier = (identifier) => (
    validIdentifier(identifier)
    && (!/^\d+$/.test(identifier) || identifier === "0" || !identifier.startsWith("0"))
  );

  return prereleaseIdentifiers.every(validPrereleaseIdentifier)
    && buildIdentifiers.every(validIdentifier);
}

async function readJsonFile(filePath, label) {
  return parseJson(await readFile(filePath, "utf8"), label);
}

function readVersion(packageJson) {
  if (typeof packageJson?.version !== "string" || packageJson.version.length === 0) {
    throw new Error("Desktop package.json does not contain a version.");
  }
  return packageJson.version;
}

export async function getDesktopVersion(packagePath = DEFAULT_PACKAGE_PATH) {
  return readVersion(await readJsonFile(packagePath, "Desktop package.json"));
}

export async function setDesktopVersion(version, paths = {}) {
  const normalizedVersion = version.trim();
  if (!isValidSemver(normalizedVersion)) {
    throw new Error(`Invalid desktop version: ${version}. Expected an Electron-compatible semantic version such as 2026.8.1; numeric parts cannot contain leading zeroes.`);
  }

  const packagePath = paths.packagePath ?? DEFAULT_PACKAGE_PATH;
  const lockPath = paths.lockPath ?? DEFAULT_LOCK_PATH;
  const [packageJson, lockJson] = await Promise.all([
    readJsonFile(packagePath, "Desktop package.json"),
    readJsonFile(lockPath, "Package lockfile")
  ]);
  readVersion(packageJson);

  const lockPackage = lockJson?.packages?.[DESKTOP_WORKSPACE_PATH];
  if (!lockPackage || typeof lockPackage !== "object") {
    throw new Error(`Package lockfile does not contain ${DESKTOP_WORKSPACE_PATH}.`);
  }

  packageJson.version = normalizedVersion;
  lockPackage.version = normalizedVersion;
  await Promise.all([
    writeFile(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`),
    writeFile(lockPath, `${JSON.stringify(lockJson, null, 2)}\n`)
  ]);
  return normalizedVersion;
}

async function runGit(args, repositoryRoot) {
  try {
    return await execFileAsync("git", args, { cwd: repositoryRoot });
  } catch (error) {
    const detail = error && typeof error === "object" && "stderr" in error
      ? String(error.stderr).trim()
      : "";
    throw new Error(detail || `Git command failed: git ${args.join(" ")}`);
  }
}

async function versionFileStatus(repositoryRoot) {
  const result = await runGit([
    "status",
    "--porcelain",
    "--",
    ...DESKTOP_VERSION_PATHS
  ], repositoryRoot);
  return result.stdout.trim();
}

export async function updateAndCommitDesktopVersion(version, repositoryRoot = REPOSITORY_ROOT) {
  const existingStatus = await versionFileStatus(repositoryRoot);
  if (existingStatus) {
    throw new Error(`Cannot update the desktop version because version files already have changes:\n${existingStatus}`);
  }

  const packagePath = path.join(repositoryRoot, DESKTOP_WORKSPACE_PATH, "package.json");
  const lockPath = path.join(repositoryRoot, "package-lock.json");
  const updatedVersion = await setDesktopVersion(version, { packagePath, lockPath });
  if (!await versionFileStatus(repositoryRoot)) {
    return { version: updatedVersion, committed: false, commit: null };
  }

  await runGit([
    "commit",
    "--only",
    "-m",
    `chore(desktop): bump version to ${updatedVersion}`,
    "--",
    ...DESKTOP_VERSION_PATHS
  ], repositoryRoot);
  const commit = await runGit(["rev-parse", "--short", "HEAD"], repositoryRoot);
  return { version: updatedVersion, committed: true, commit: commit.stdout.trim() };
}

async function main(args) {
  if (args.length === 0) {
    process.stdout.write(`${await getDesktopVersion()}\n`);
    return;
  }
  if (args.length > 1) {
    throw new Error("Usage: npm run version:desktop -- [version]");
  }
  const result = await updateAndCommitDesktopVersion(args[0]);
  if (result.committed) {
    process.stdout.write(`Updated desktop version to ${result.version} and committed ${result.commit}.\n`);
    return;
  }
  process.stdout.write(`Desktop version is already ${result.version}; no commit created.\n`);
}

const isMain = process.argv[1]
  && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (isMain) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}

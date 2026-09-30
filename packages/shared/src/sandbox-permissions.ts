import fs from "node:fs/promises";
import path from "node:path";
import { isWithinPath } from "./fs-guards.js";

const DIR_READABLE_MODE = 0o755;
const FILE_READABLE_MODE = 0o644;
const DIR_WRITABLE_MODE = 0o2775;
const FILE_WRITABLE_MODE = 0o664;

interface SandboxPermissionProfile {
  directoryMode: number;
  fileMode: number;
}

const READABLE_PROFILE: SandboxPermissionProfile = {
  directoryMode: DIR_READABLE_MODE,
  fileMode: FILE_READABLE_MODE
};

const WRITABLE_PROFILE: SandboxPermissionProfile = {
  directoryMode: DIR_WRITABLE_MODE,
  fileMode: FILE_WRITABLE_MODE
};

function isIgnorablePermissionNormalizationError(error: unknown): boolean {
  if (!(error instanceof Error) || !("code" in error)) {
    return false;
  }

  const code = error.code;
  return code === "ENOSYS"
    || code === "ENOTSUP"
    || code === "EOPNOTSUPP"
    || code === "EPERM"
    || code === "EROFS"
    || code === "EINVAL";
}

async function ensureMinimumMode(targetPath: string, minimumMode: number): Promise<void> {
  const stats = await fs.lstat(targetPath).catch(() => null);
  if (!stats || stats.isSymbolicLink()) {
    return;
  }

  const currentMode = stats.mode & 0o7777;
  const nextMode = currentMode | minimumMode;
  if (nextMode !== currentMode) {
    try {
      await fs.chmod(targetPath, nextMode);
    } catch (error) {
      if (!isIgnorablePermissionNormalizationError(error)) {
        throw error;
      }
    }
  }
}

async function ensureDirectoryChainMinimumMode(
  rootPath: string,
  targetPath: string,
  profile: SandboxPermissionProfile
): Promise<void> {
  const resolvedRoot = path.resolve(rootPath);
  const resolvedTarget = path.resolve(targetPath);
  if (!isWithinPath(resolvedRoot, resolvedTarget)) {
    throw new Error(`Target path is outside the sandbox-root boundary: ${resolvedTarget}`);
  }

  const relative = path.relative(resolvedRoot, resolvedTarget);
  const parts = relative.length > 0
    ? relative.split(path.sep).filter((part) => part.length > 0)
    : [];

  let currentPath = resolvedRoot;
  await ensureMinimumMode(currentPath, profile.directoryMode);

  for (const part of parts) {
    currentPath = path.join(currentPath, part);
    await ensureMinimumMode(currentPath, profile.directoryMode);
  }
}

async function ensureTreeMinimumMode(targetPath: string, profile: SandboxPermissionProfile): Promise<void> {
  const stats = await fs.lstat(targetPath).catch(() => null);
  if (!stats || stats.isSymbolicLink()) {
    return;
  }

  if (stats.isDirectory()) {
    await ensureMinimumMode(targetPath, profile.directoryMode);
    const entries = await fs.readdir(targetPath, { withFileTypes: true });
    await Promise.all(entries.map(async (entry) => {
      await ensureTreeMinimumMode(path.join(targetPath, entry.name), profile);
    }));
    return;
  }

  if (stats.isFile()) {
    await ensureMinimumMode(targetPath, profile.fileMode);
  }
}

async function ensureSandboxPathPermissions(
  input: {
    rootPath: string;
    targetPath: string;
    recursive?: boolean;
  },
  profile: SandboxPermissionProfile
): Promise<void> {
  const resolvedRoot = path.resolve(input.rootPath);
  const resolvedTarget = path.resolve(input.targetPath);
  if (!isWithinPath(resolvedRoot, resolvedTarget)) {
    throw new Error(`Target path is outside the sandbox-root boundary: ${resolvedTarget}`);
  }

  const stats = await fs.lstat(resolvedTarget).catch(() => null);
  if (!stats) {
    return;
  }

  if (stats.isDirectory()) {
    await ensureDirectoryChainMinimumMode(resolvedRoot, resolvedTarget, profile);
    if (input.recursive === true) {
      await ensureTreeMinimumMode(resolvedTarget, profile);
    }
    return;
  }

  await ensureDirectoryChainMinimumMode(resolvedRoot, path.dirname(resolvedTarget), profile);
  if (stats.isFile()) {
    await ensureMinimumMode(resolvedTarget, profile.fileMode);
  }
}

export async function ensureSandboxReadablePath(input: {
  rootPath: string;
  targetPath: string;
  recursive?: boolean;
}): Promise<void> {
  await ensureSandboxPathPermissions(input, READABLE_PROFILE);
}

export async function ensureSandboxWritablePath(input: {
  rootPath: string;
  targetPath: string;
  recursive?: boolean;
}): Promise<void> {
  await ensureSandboxPathPermissions(input, WRITABLE_PROFILE);
}

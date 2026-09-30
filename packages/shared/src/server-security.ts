import dns from "node:dns/promises";
import { constants } from "node:fs";
import fs from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import path from "node:path";
import net from "node:net";
import { isWithinPath } from "./fs-guards.js";

export interface ResolvedRootPath {
  rootRealPath: string;
  absolutePath: string;
  relativePath: string;
}

export interface PublicUrlValidationResult {
  url: URL;
  resolvedAddresses: string[];
}

export interface OpenedReadablePath {
  fileHandle: FileHandle;
  realPath: string;
}

function toWebPath(input: string): string {
  return input.split(path.sep).join("/");
}

function trimRequestedPath(requestedPath?: string): string {
  const trimmed = requestedPath?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : ".";
}

export async function resolveRealPathWithinRoot(rootPath: string, requestedPath?: string): Promise<ResolvedRootPath> {
  const rootRealPath = await fs.realpath(rootPath);
  const lexicalPath = path.resolve(rootRealPath, trimRequestedPath(requestedPath));
  if (!isWithinPath(rootRealPath, lexicalPath)) {
    throw new Error("Path is outside environment root");
  }

  const absolutePath = await fs.realpath(lexicalPath);
  if (!isWithinPath(rootRealPath, absolutePath)) {
    throw new Error("Path escapes the environment root");
  }

  const relativePath = path.relative(rootRealPath, absolutePath);
  return {
    rootRealPath,
    absolutePath,
    relativePath: relativePath === "" ? "" : toWebPath(relativePath)
  };
}

export async function ensureDirectoryWithinRoot(input: {
  rootPath: string;
  requestedPath?: string;
  createDirectories?: boolean;
}): Promise<ResolvedRootPath> {
  const rootRealPath = await fs.realpath(input.rootPath);
  const lexicalPath = path.resolve(rootRealPath, trimRequestedPath(input.requestedPath));
  if (!isWithinPath(rootRealPath, lexicalPath)) {
    throw new Error("Path is outside environment root");
  }

  const relativePath = path.relative(rootRealPath, lexicalPath);
  if (relativePath === "") {
    return {
      rootRealPath,
      absolutePath: rootRealPath,
      relativePath: ""
    };
  }

  const segments = relativePath.split(path.sep).filter((segment) => segment.length > 0);
  let currentPath = rootRealPath;

  for (const segment of segments) {
    const nextPath = path.join(currentPath, segment);
    const nextStats = await fs.lstat(nextPath).catch(() => null);

    if (!nextStats) {
      if (!input.createDirectories) {
        throw new Error("Directory not found");
      }
      await fs.mkdir(nextPath).catch((error: unknown) => {
        if (error instanceof Error && "code" in error && error.code === "EEXIST") {
          return;
        }

        throw error;
      });
      const createdStats = await fs.lstat(nextPath);
      if (createdStats.isSymbolicLink()) {
        throw new Error("Directory path contains a symbolic link");
      }
      if (!createdStats.isDirectory()) {
        throw new Error("Upload destination must be an existing directory");
      }
      currentPath = await fs.realpath(nextPath);
      if (!isWithinPath(rootRealPath, currentPath)) {
        throw new Error("Path escapes the environment root");
      }
      continue;
    }

    if (nextStats.isSymbolicLink()) {
      throw new Error("Directory path contains a symbolic link");
    }
    if (!nextStats.isDirectory()) {
      throw new Error("Upload destination must be an existing directory");
    }

    currentPath = await fs.realpath(nextPath);
    if (!isWithinPath(rootRealPath, currentPath)) {
      throw new Error("Path escapes the environment root");
    }
  }

  return {
    rootRealPath,
    absolutePath: currentPath,
    relativePath: toWebPath(relativePath)
  };
}

interface ResolvedReadablePath {
  candidatePath: string;
  realPath: string;
  realRootPath: string;
}

async function resolveReadablePathCandidateWithinRoots(
  roots: string[],
  requestedPath: string
): Promise<ResolvedReadablePath> {
  const trimmedRequestedPath = requestedPath.trim();
  const candidatePaths = path.isAbsolute(trimmedRequestedPath)
    ? [path.resolve(trimmedRequestedPath)]
    : roots.map((rootPath) => path.resolve(rootPath, trimmedRequestedPath));
  const uniqueCandidatePaths = [...new Set(candidatePaths)];
  const resolvedRoots = await Promise.all(roots.map(async (rootPath) => ({
    absoluteRootPath: path.resolve(rootPath),
    realRootPath: await fs.realpath(rootPath).catch(() => null)
  })));

  let resolutionError: unknown;
  for (const candidatePath of uniqueCandidatePaths) {
    const realRequestedPath = await fs.realpath(candidatePath).catch((error: unknown) => {
      if (resolvedRoots.some((root) =>
        isWithinPath(root.absoluteRootPath, candidatePath) ||
        (root.realRootPath && isWithinPath(root.realRootPath, candidatePath))
      )) {
        resolutionError ??= error;
      }
      return null;
    });
    if (!realRequestedPath) {
      continue;
    }

    for (const root of resolvedRoots) {
      if (!root.realRootPath) {
        continue;
      }

      if (isWithinPath(root.realRootPath, realRequestedPath)) {
        return {
          candidatePath,
          realPath: realRequestedPath,
          realRootPath: root.realRootPath
        };
      }
    }
  }

  if (resolutionError) {
    throw resolutionError;
  }
  throw new Error(`Read operation denied outside allowed roots: ${requestedPath}`);
}

export async function resolveReadablePathWithinRoots(roots: string[], requestedPath: string): Promise<string> {
  return (await resolveReadablePathCandidateWithinRoots(roots, requestedPath)).realPath;
}

export async function openReadablePathWithinRoots(
  roots: string[],
  requestedPath: string
): Promise<OpenedReadablePath> {
  const resolved = await resolveReadablePathCandidateWithinRoots(roots, requestedPath);
  const fileHandle = await fs.open(resolved.realPath, constants.O_RDONLY | constants.O_NOFOLLOW);

  try {
    const [openedStats, revalidatedPath] = await Promise.all([
      fileHandle.stat(),
      fs.realpath(resolved.candidatePath)
    ]);
    if (!isWithinPath(resolved.realRootPath, revalidatedPath)) {
      throw new Error(`Read operation denied outside allowed roots: ${requestedPath}`);
    }

    const revalidatedStats = await fs.stat(revalidatedPath);
    if (openedStats.dev !== revalidatedStats.dev || openedStats.ino !== revalidatedStats.ino) {
      throw new Error("Readable path changed while it was being opened");
    }

    return { fileHandle, realPath: revalidatedPath };
  } catch (error) {
    await fileHandle.close();
    throw error;
  }
}

function parseIpv4(address: string): [number, number, number, number] | null {
  const parts = address.split(".");
  if (parts.length !== 4) {
    return null;
  }

  const numbers = parts.map((part) => Number.parseInt(part, 10));
  if (numbers.some((value, index) => !Number.isInteger(value) || value < 0 || value > 255 || String(value) !== String(parts[index]))) {
    return null;
  }

  return [numbers[0], numbers[1], numbers[2], numbers[3]];
}

function isPrivateIpv4(address: string): boolean {
  const parts = parseIpv4(address);
  if (!parts) {
    return false;
  }

  const [a, b] = parts;

  if (a === 0 || a === 10 || a === 127) {
    return true;
  }
  if (a === 100 && b >= 64 && b <= 127) {
    return true;
  }
  if (a === 169 && b === 254) {
    return true;
  }
  if (a === 172 && b >= 16 && b <= 31) {
    return true;
  }
  if (a === 192 && (b === 0 || b === 168)) {
    return true;
  }
  if (a === 198 && (b === 18 || b === 19 || b === 51)) {
    return true;
  }
  if (a === 203 && b === 0) {
    return true;
  }
  if (a >= 224) {
    return true;
  }

  return false;
}

function normalizeIpv6(address: string): string {
  const percentIndex = address.indexOf("%");
  if (percentIndex >= 0) {
    return address.slice(0, percentIndex).toLowerCase();
  }
  return address.toLowerCase();
}

function isPrivateIpv6(address: string): boolean {
  const normalized = normalizeIpv6(address);

  if (normalized === "::" || normalized === "::1") {
    return true;
  }
  if (normalized.startsWith("::ffff:")) {
    const mappedIpv4 = normalized.slice("::ffff:".length);
    return isPrivateIpv4(mappedIpv4);
  }
  if (normalized.startsWith("fc") || normalized.startsWith("fd")) {
    return true;
  }
  if (normalized.startsWith("fe8") || normalized.startsWith("fe9") || normalized.startsWith("fea") || normalized.startsWith("feb") || normalized.startsWith("fec") || normalized.startsWith("fed") || normalized.startsWith("fee") || normalized.startsWith("fef")) {
    return true;
  }
  if (normalized.startsWith("ff")) {
    return true;
  }
  if (normalized.startsWith("2001:db8:")) {
    return true;
  }

  return false;
}

function isPrivateIpAddress(address: string): boolean {
  const family = net.isIP(address);
  if (family === 4) {
    return isPrivateIpv4(address);
  }
  if (family === 6) {
    return isPrivateIpv6(address);
  }
  return true;
}

async function resolveHostAddresses(hostname: string): Promise<string[]> {
  if (net.isIP(hostname)) {
    return [hostname];
  }

  const records = await dns.lookup(hostname, { all: true, verbatim: true });
  const addresses = records
    .map((record) => record.address)
    .filter((address, index, list) => address.length > 0 && list.indexOf(address) === index);

  if (addresses.length === 0) {
    throw new Error(`Host does not resolve to any IP addresses: ${hostname}`);
  }

  return addresses;
}

export async function assertSafePublicUrl(urlString: string, label = "URL"): Promise<PublicUrlValidationResult> {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(urlString);
  } catch {
    throw new Error(`${label} is invalid.`);
  }

  if (parsedUrl.protocol !== "https:" && parsedUrl.protocol !== "http:") {
    throw new Error(`${label} must use http or https.`);
  }

  const hostname = parsedUrl.hostname.trim().toLowerCase();
  if (!hostname) {
    throw new Error(`${label} is missing a hostname.`);
  }
  if (hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local")) {
    throw new Error(`${label} must not target localhost or local-only hosts.`);
  }

  const resolvedAddresses = await resolveHostAddresses(hostname);
  const privateAddress = resolvedAddresses.find((address) => isPrivateIpAddress(address));
  if (privateAddress) {
    throw new Error(`${label} resolves to a private or internal address (${privateAddress}).`);
  }

  return {
    url: parsedUrl,
    resolvedAddresses
  };
}

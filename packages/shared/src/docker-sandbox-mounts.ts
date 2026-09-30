import { createHash } from "node:crypto";
import path from "node:path";
import type { ContainerInspectInfo } from "dockerode";

export interface MountedPathInfo {
  destination: string;
  source: string;
}

export interface LiveMountInfo {
  mountPoint: string;
  filesystemType: string;
}

export interface NestedMountMirrorPlan {
  liveMountPoint: string;
  staticMountDestination: string;
  relativePath: string;
}

export interface ResolvedSandboxMount {
  source: string;
  sourceKind: "direct" | "mirror";
  destination: string;
  accessiblePath: string;
  readOnly: boolean;
}

export interface ResolvedMountSource {
  source: string;
  sourceKind: "direct" | "mirror";
}

export function dedupeNestedPaths(paths: string[]): string[] {
  const orderedPaths = [...new Set(paths.map((value) => path.resolve(value)))].sort((left, right) => {
    if (left.length === right.length) {
      return left.localeCompare(right);
    }
    return left.length - right.length;
  });

  const deduped: string[] = [];
  for (const candidatePath of orderedPaths) {
    if (deduped.some((existingPath) => candidatePath === existingPath || candidatePath.startsWith(`${existingPath}${path.sep}`))) {
      continue;
    }
    deduped.push(candidatePath);
  }

  return deduped;
}

export function listWritableMountRoots(mounts: ResolvedSandboxMount[]): string[] {
  return [...new Set(
    mounts
      .filter((mount) => !mount.readOnly)
      .map((mount) => path.resolve(mount.accessiblePath))
  )];
}

export function readContainerMounts(inspect: ContainerInspectInfo): MountedPathInfo[] {
  return (inspect.Mounts ?? [])
    .map((mount) => {
      const destination = mount.Destination?.trim();
      const source = mount.Source?.trim();
      if (!destination || !source) {
        return null;
      }
      return {
        destination,
        source
      };
    })
    .filter((mount): mount is MountedPathInfo => mount !== null)
    .sort((left, right) => right.destination.length - left.destination.length);
}

export function mapContainerPathToHostPath(mounts: MountedPathInfo[], containerPath: string): string | null {
  const resolvedPath = path.resolve(containerPath);
  for (const mount of mounts) {
    const destination = path.resolve(mount.destination);
    if (resolvedPath !== destination && !resolvedPath.startsWith(`${destination}${path.sep}`)) {
      continue;
    }

    const relativePath = path.relative(destination, resolvedPath);
    return relativePath ? path.join(mount.source, relativePath) : mount.source;
  }

  return null;
}

function decodeMountInfoPath(value: string): string {
  return value.replace(/\\([0-7]{3})/g, (_match, octalValue: string) =>
    String.fromCharCode(Number.parseInt(octalValue, 8))
  );
}

export function readLiveMountEntries(mountInfoText: string): LiveMountInfo[] {
  return mountInfoText
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      const separator = line.indexOf(" - ");
      if (separator < 0) {
        return null;
      }

      const leftFields = line.slice(0, separator).split(" ");
      const mountPoint = leftFields[4];
      const rightFields = line.slice(separator + 3).split(" ");
      const filesystemType = rightFields[0];
      if (!mountPoint || !filesystemType) {
        return null;
      }

      return {
        mountPoint: path.resolve(decodeMountInfoPath(mountPoint)),
        filesystemType: filesystemType.trim().toLowerCase()
      };
    })
    .filter((mountInfo): mountInfo is LiveMountInfo => mountInfo !== null)
    .sort((left, right) => {
      if (left.mountPoint.length === right.mountPoint.length) {
        return left.mountPoint.localeCompare(right.mountPoint);
      }
      return right.mountPoint.length - left.mountPoint.length;
    });
}

export function readLiveMountPoints(mountInfoText: string): string[] {
  return readLiveMountEntries(mountInfoText).map((entry) => entry.mountPoint);
}

function findDeepestContainingPath(paths: string[], targetPath: string): string | null {
  const resolvedTargetPath = path.resolve(targetPath);
  let deepestMatch: string | null = null;
  for (const candidatePath of paths) {
    const resolvedCandidatePath = path.resolve(candidatePath);
    if (
      resolvedTargetPath === resolvedCandidatePath
      || resolvedTargetPath.startsWith(`${resolvedCandidatePath}${path.sep}`)
    ) {
      if (!deepestMatch || resolvedCandidatePath.length > deepestMatch.length) {
        deepestMatch = resolvedCandidatePath;
      }
    }
  }

  return deepestMatch;
}

function findDeepestContainingLiveMount(liveMounts: LiveMountInfo[], targetPath: string): LiveMountInfo | null {
  const resolvedTargetPath = path.resolve(targetPath);
  let deepestMatch: LiveMountInfo | null = null;
  for (const candidateMount of liveMounts) {
    const resolvedCandidatePath = path.resolve(candidateMount.mountPoint);
    if (
      resolvedTargetPath === resolvedCandidatePath
      || resolvedTargetPath.startsWith(`${resolvedCandidatePath}${path.sep}`)
    ) {
      if (!deepestMatch || resolvedCandidatePath.length > deepestMatch.mountPoint.length) {
        deepestMatch = candidateMount;
      }
    }
  }

  return deepestMatch;
}

export function isContainerPrivateLiveMount(filesystemType: string): boolean {
  const normalizedType = filesystemType.trim().toLowerCase();
  return normalizedType.startsWith("fuse.")
    || normalizedType === "nfs"
    || normalizedType.startsWith("nfs")
    || normalizedType === "cifs"
    || normalizedType === "smb3";
}

export function resolveNestedMountMirrorPlan(input: {
  containerPath: string;
  staticMountDestinations: string[];
  liveMounts: LiveMountInfo[];
}): NestedMountMirrorPlan | null {
  const resolvedContainerPath = path.resolve(input.containerPath);
  const staticMountDestination = findDeepestContainingPath(input.staticMountDestinations, resolvedContainerPath);
  if (!staticMountDestination) {
    return null;
  }

  const liveMount = findDeepestContainingLiveMount(input.liveMounts, resolvedContainerPath);
  if (!liveMount || liveMount.mountPoint === staticMountDestination) {
    return null;
  }
  if (!isContainerPrivateLiveMount(liveMount.filesystemType)) {
    return null;
  }
  const liveMountPoint = liveMount.mountPoint;
  if (!liveMountPoint.startsWith(`${staticMountDestination}${path.sep}`)) {
    return null;
  }

  return {
    liveMountPoint,
    staticMountDestination,
    relativePath: path.relative(liveMountPoint, resolvedContainerPath)
  };
}

function sanitizeMirrorNamespace(value: string | null | undefined): string {
  const trimmed = value?.trim() ?? "";
  return trimmed.replace(/[^a-zA-Z0-9._-]/g, "_") || "default";
}

export function buildNestedMountMirrorPath(
  staticMountDestination: string,
  liveMountPoint: string,
  mirrorNamespace?: string | null
): string {
  const hash = createHash("sha256").update(path.resolve(liveMountPoint)).digest("hex").slice(0, 24);
  return path.resolve(
    staticMountDestination,
    ".meowbert-sandbox-mirrors",
    sanitizeMirrorNamespace(mirrorNamespace),
    hash
  );
}

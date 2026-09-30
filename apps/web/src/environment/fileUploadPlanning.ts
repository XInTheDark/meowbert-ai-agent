import { normalizeEnvironmentPathInput } from "./environmentFiles";

export interface PlannedViewerUpload {
  file: File;
  label: string;
  relativePath: string;
  targetPath: string;
  createDirectories: boolean;
}

type ViewerUploadFilesInput = FileList | File[] | null;

function normalizeSelectedUploadPath(file: File): string {
  const rawRelativePath = typeof file.webkitRelativePath === "string" ? file.webkitRelativePath.trim() : "";
  const candidatePath = rawRelativePath.length > 0 ? rawRelativePath : file.name;
  const normalizedPath = normalizeEnvironmentPathInput(candidatePath);
  return normalizedPath || normalizeEnvironmentPathInput(file.name) || "upload.bin";
}

function extractParentPath(relativePath: string): string {
  const lastSlashIndex = relativePath.lastIndexOf("/");
  return lastSlashIndex === -1 ? "" : relativePath.slice(0, lastSlashIndex);
}

function joinUploadPaths(basePath: string, nestedPath: string): string {
  const normalizedSegments = [basePath, nestedPath]
    .map((segment) => normalizeEnvironmentPathInput(segment))
    .filter((segment) => segment.length > 0);

  return normalizedSegments.join("/");
}

export function planViewerUploads(basePath: string, files: ViewerUploadFilesInput): PlannedViewerUpload[] {
  const normalizedFiles = Array.isArray(files) ? files : files ? Array.from(files) : [];

  return normalizedFiles.map((file) => {
    const relativePath = normalizeSelectedUploadPath(file);
    const nestedPath = extractParentPath(relativePath);

    return {
      file,
      label: relativePath,
      relativePath,
      targetPath: joinUploadPaths(basePath, nestedPath),
      createDirectories: nestedPath.length > 0
    };
  });
}

export function buildViewerUploadQuery(upload: Pick<PlannedViewerUpload, "targetPath" | "createDirectories">): string {
  const params = new URLSearchParams();

  if (upload.targetPath) {
    params.set("path", upload.targetPath);
  }

  if (upload.createDirectories) {
    params.set("createDirectories", "true");
  }

  const serialized = params.toString();
  return serialized ? `?${serialized}` : "";
}

export function selectionIncludesFolder(uploadPlans: PlannedViewerUpload[]): boolean {
  return uploadPlans.some((upload) => upload.relativePath !== upload.file.name);
}

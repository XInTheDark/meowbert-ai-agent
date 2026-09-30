const IMAGE_FILE_EXTENSIONS = new Set([
  "apng",
  "avif",
  "bmp",
  "gif",
  "ico",
  "jpeg",
  "jpg",
  "png",
  "svg",
  "webp"
]);

export type InlineFilePreviewKind = "image" | "pdf";

function getFileExtension(relativePath: string): string | null {
  const filename = relativePath.split("/").pop() ?? relativePath;
  const dotIndex = filename.lastIndexOf(".");
  if (dotIndex < 0 || dotIndex === filename.length - 1) {
    return null;
  }

  return filename.slice(dotIndex + 1).toLowerCase();
}

export function getInlineFilePreviewKind(relativePath: string): InlineFilePreviewKind | null {
  const extension = getFileExtension(relativePath);
  if (!extension) {
    return null;
  }

  if (extension === "pdf") {
    return "pdf";
  }

  return IMAGE_FILE_EXTENSIONS.has(extension) ? "image" : null;
}

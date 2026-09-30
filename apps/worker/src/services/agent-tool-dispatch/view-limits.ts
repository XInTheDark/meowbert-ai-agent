export const IMAGE_MIME_SNIFF_BYTES = 8 * 1024;
export const VIEW_IMAGE_MAX_BYTES = 20 * 1024 * 1024;
export const VIEW_PDF_MAX_INPUT_BYTES = 50 * 1024 * 1024;
export const VIEW_PDF_MAX_OUTPUT_BYTES = 25 * 1024 * 1024;

export function formatByteLimit(bytes: number): string {
  if (bytes >= 1024 * 1024) {
    return `${Math.floor(bytes / (1024 * 1024))} MB`;
  }
  if (bytes >= 1024) {
    return `${Math.floor(bytes / 1024)} KB`;
  }

  return `${bytes} B`;
}

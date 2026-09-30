export function downloadTextFile(input: { filename: string; mimeType: string; content: string }): void {
  const blob = new Blob([input.content], { type: `${input.mimeType};charset=utf-8` });
  const objectUrl = window.URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = input.filename;
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => {
    window.URL.revokeObjectURL(objectUrl);
  }, 0);
}

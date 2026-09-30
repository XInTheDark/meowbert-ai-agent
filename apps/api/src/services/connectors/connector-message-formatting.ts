export function buildConnectorMessageWithAttachments(baseText: string, filePaths: string[]): string {
  if (filePaths.length === 0) {
    return baseText;
  }

  const fileList = filePaths.join("\n");
  return baseText ? `${baseText}\n\nAttached files:\n${fileList}` : `Attached files:\n${fileList}`;
}

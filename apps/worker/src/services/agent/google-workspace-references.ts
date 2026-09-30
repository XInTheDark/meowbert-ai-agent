export interface GoogleWorkspaceRuntimeReference {
  path: string | null;
  itemId: string;
  itemReference: string;
  name: string;
  mimeType: string;
  webUrl: string | null;
  referenceToken: string;
}

export function serializeGoogleWorkspaceReferences(
  references: GoogleWorkspaceRuntimeReference[]
): string {
  return JSON.stringify({ references });
}

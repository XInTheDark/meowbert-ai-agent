export const GOOGLE_WORKSPACE_REFERENCE_KIND = "google_workspace_reference" as const;
export const GOOGLE_WORKSPACE_REFERENCE_VERSION = 1 as const;
export const GOOGLE_DRIVE_RESOURCE_KEY_SEPARATOR = "::resourceKey::";

export const GOOGLE_WORKSPACE_REFERENCE_EXTENSIONS = {
  "application/vnd.google-apps.document": ".gdoc",
  "application/vnd.google-apps.spreadsheet": ".gsheet",
  "application/vnd.google-apps.presentation": ".gslides"
} as const;

export type GoogleWorkspaceReferenceMimeType = keyof typeof GOOGLE_WORKSPACE_REFERENCE_EXTENSIONS;

export interface GoogleWorkspaceReferenceScope {
  kind: "project";
  workspaceId: string;
  environmentId: string;
  taskId: null;
}

export interface GoogleWorkspaceReferencePayload {
  version: typeof GOOGLE_WORKSPACE_REFERENCE_VERSION;
  kind: typeof GOOGLE_WORKSPACE_REFERENCE_KIND;
  sourceId: string;
  provider: "google-drive";
  itemReference: string;
  itemId: string;
  resourceKey: string | null;
  name: string;
  mimeType: GoogleWorkspaceReferenceMimeType;
  webUrl: string | null;
  scope: GoogleWorkspaceReferenceScope;
}

export interface GoogleWorkspaceReferenceFile extends GoogleWorkspaceReferencePayload {
  referenceToken: string;
}

export function isGoogleWorkspaceReferenceMimeType(
  value: string | null | undefined
): value is GoogleWorkspaceReferenceMimeType {
  return typeof value === "string" && value in GOOGLE_WORKSPACE_REFERENCE_EXTENSIONS;
}

export function getGoogleWorkspaceReferenceExtension(
  mimeType: GoogleWorkspaceReferenceMimeType
): string {
  return GOOGLE_WORKSPACE_REFERENCE_EXTENSIONS[mimeType];
}

export function decodeGoogleDriveItemReference(value: string): {
  itemId: string;
  resourceKey: string | null;
} {
  const [itemId, resourceKey] = value.split(GOOGLE_DRIVE_RESOURCE_KEY_SEPARATOR, 2);
  return {
    itemId: itemId ?? value,
    resourceKey: resourceKey?.trim() || null
  };
}

import { createHmac, timingSafeEqual } from "node:crypto";
import { secrets } from "../../../lib/config.js";
import {
  GOOGLE_WORKSPACE_REFERENCE_KIND,
  GOOGLE_WORKSPACE_REFERENCE_VERSION,
  isGoogleWorkspaceReferenceMimeType,
  type GoogleWorkspaceReferencePayload
} from "./reference-types.js";

function base64UrlEncode(value: Buffer | string): string {
  const buffer = typeof value === "string" ? Buffer.from(value, "utf8") : value;
  return buffer.toString("base64url");
}

function base64UrlDecode(value: string): Buffer {
  return Buffer.from(value, "base64url");
}

function signEncodedPayload(encodedPayload: string): Buffer {
  return createHmac("sha256", secrets.jwtSecret).update(encodedPayload).digest();
}

function isReferencePayload(value: unknown): value is GoogleWorkspaceReferencePayload {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const candidate = value as Partial<GoogleWorkspaceReferencePayload>;
  const scope = candidate.scope;
  if (!scope || typeof scope !== "object" || Array.isArray(scope)) {
    return false;
  }

  const validScope = scope.kind === "project"
    && typeof scope.workspaceId === "string"
    && typeof scope.environmentId === "string"
    && scope.taskId === null;

  return candidate.version === GOOGLE_WORKSPACE_REFERENCE_VERSION
    && candidate.kind === GOOGLE_WORKSPACE_REFERENCE_KIND
    && candidate.provider === "google-drive"
    && typeof candidate.sourceId === "string"
    && typeof candidate.itemReference === "string"
    && typeof candidate.itemId === "string"
    && (typeof candidate.resourceKey === "string" || candidate.resourceKey === null)
    && typeof candidate.name === "string"
    && isGoogleWorkspaceReferenceMimeType(candidate.mimeType)
    && (typeof candidate.webUrl === "string" || candidate.webUrl === null)
    && validScope;
}

export function signGoogleWorkspaceReference(payload: GoogleWorkspaceReferencePayload): string {
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const signature = base64UrlEncode(signEncodedPayload(encodedPayload));
  return `${encodedPayload}.${signature}`;
}

export function verifyGoogleWorkspaceReferenceToken(token: string): GoogleWorkspaceReferencePayload {
  const [encodedPayload, encodedSignature, ...rest] = token.split(".");
  if (!encodedPayload || !encodedSignature || rest.length > 0) {
    throw new Error("Google Workspace reference token is invalid.");
  }

  const suppliedSignature = base64UrlDecode(encodedSignature);
  const expectedSignature = signEncodedPayload(encodedPayload);
  if (
    suppliedSignature.length !== expectedSignature.length
    || !timingSafeEqual(suppliedSignature, expectedSignature)
  ) {
    throw new Error("Google Workspace reference token is invalid.");
  }

  let payload: unknown;
  try {
    payload = JSON.parse(base64UrlDecode(encodedPayload).toString("utf8"));
  } catch {
    throw new Error("Google Workspace reference token is invalid.");
  }

  if (!isReferencePayload(payload)) {
    throw new Error("Google Workspace reference token is invalid.");
  }

  return payload;
}

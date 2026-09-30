import { GoogleWorkspaceProxyError } from "./proxy-errors.js";
import type { GoogleWorkspaceReferencePayload } from "./reference-types.js";
import { getGoogleWorkspaceExport } from "../google-drive-file-types.js";

const READ_METHODS = new Set(["GET"]);
const POST_METHODS = new Set(["POST"]);
const SHEET_VALUE_METHODS = new Set(["GET", "POST", "PUT"]);
const DRIVE_COMMENT_METHODS = new Set(["GET", "POST", "PATCH"]);

export interface GoogleWorkspaceProxyRequest {
  method: string;
  url: string;
  headers: Record<string, string>;
  bodyBase64: string | null;
}

export interface AuthorizedGoogleWorkspaceRequest {
  method: string;
  url: URL;
  headers: Record<string, string>;
  body: Buffer | undefined;
  mutating: boolean;
}

function decodePathId(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    throw new GoogleWorkspaceProxyError("Google Workspace request path is invalid.", 400);
  }
}

function matchTarget(url: URL): {
  encodedId: string;
  methods: Set<string>;
  mimeType: GoogleWorkspaceReferencePayload["mimeType"] | null;
} | null {
  const path = url.pathname;
  if (url.hostname === "docs.googleapis.com") {
    const match = path.match(/^\/v1\/documents\/([^/:]+)(:batchUpdate)?$/);
    return match?.[1]
      ? {
          encodedId: match[1],
          methods: match[2] ? POST_METHODS : READ_METHODS,
          mimeType: "application/vnd.google-apps.document"
        }
      : null;
  }
  if (url.hostname === "sheets.googleapis.com") {
    const match = path.match(/^\/v4\/spreadsheets\/([^/:]+)(:batchUpdate|\/values(?:\/|:|$).*)?$/);
    if (!match?.[1]) {
      return null;
    }
    return {
      encodedId: match[1],
      methods: match[2] === ":batchUpdate"
        ? POST_METHODS
        : match[2]?.startsWith("/values")
          ? SHEET_VALUE_METHODS
          : READ_METHODS,
      mimeType: "application/vnd.google-apps.spreadsheet"
    };
  }
  if (url.hostname === "slides.googleapis.com") {
    const match = path.match(/^\/v1\/presentations\/([^/:]+)(:batchUpdate|\/pages\/[^/]+(?:\/thumbnail)?)?$/);
    return match?.[1]
      ? {
          encodedId: match[1],
          methods: match[2] === ":batchUpdate" ? POST_METHODS : READ_METHODS,
          mimeType: "application/vnd.google-apps.presentation"
        }
      : null;
  }
  if (url.hostname === "www.googleapis.com") {
    const match = path.match(/^\/drive\/v3\/files\/([^/]+)(\/export|\/comments(?:\/[^/]+(?:\/replies(?:\/[^/]+)?)?)?)?$/);
    return match?.[1]
      ? {
          encodedId: match[1],
          methods: match[2]?.startsWith("/comments") ? DRIVE_COMMENT_METHODS : READ_METHODS,
          mimeType: null
        }
      : null;
  }
  return null;
}

function buildForwardHeaders(headers: Record<string, string>): Record<string, string> {
  const forwarded: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    const normalized = name.toLowerCase();
    if (normalized === "accept" || normalized === "content-type") {
      forwarded[normalized] = value;
    }
  }
  return forwarded;
}

function decodeBody(bodyBase64: string | null): Buffer | undefined {
  if (!bodyBase64) {
    return undefined;
  }
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(bodyBase64) || bodyBase64.length > 20_000_000) {
    throw new GoogleWorkspaceProxyError("Google Workspace request body is invalid.", 400);
  }
  return Buffer.from(bodyBase64, "base64");
}

export function authorizeGoogleWorkspaceRequest(input: {
  request: GoogleWorkspaceProxyRequest;
  reference: GoogleWorkspaceReferencePayload;
}): AuthorizedGoogleWorkspaceRequest {
  const method = input.request.method.toUpperCase();
  let url: URL;
  try {
    url = new URL(input.request.url);
  } catch {
    throw new GoogleWorkspaceProxyError("Google Workspace request URL is invalid.", 400);
  }
  if (url.protocol !== "https:" || url.port || url.username || url.password) {
    throw new GoogleWorkspaceProxyError("Google Workspace request URL is not allowed.", 403);
  }

  const target = matchTarget(url);
  if (!target || decodePathId(target.encodedId) !== input.reference.itemId) {
    throw new GoogleWorkspaceProxyError(
      "Google Workspace tools may only access the directly attached file.",
      403
    );
  }
  if (target.mimeType !== null && target.mimeType !== input.reference.mimeType) {
    throw new GoogleWorkspaceProxyError(
      "Google Workspace request does not match the attached file type.",
      403
    );
  }
  if (!target.methods.has(method)) {
    throw new GoogleWorkspaceProxyError("Google Workspace request method is not allowed.", 403);
  }
  if (url.hostname === "www.googleapis.com" && url.pathname.endsWith("/export")) {
    const format = getGoogleWorkspaceExport(input.reference.mimeType);
    if (!format || url.searchParams.getAll("mimeType").length !== 1 || url.searchParams.get("mimeType") !== format.mimeType) {
      throw new GoogleWorkspaceProxyError("Google Workspace export must use the Office format for the attached file type.", 400);
    }
  }

  return {
    method,
    url,
    headers: buildForwardHeaders(input.request.headers),
    body: decodeBody(input.request.bodyBase64),
    mutating: method !== "GET"
  };
}

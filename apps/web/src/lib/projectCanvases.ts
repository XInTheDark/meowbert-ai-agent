import { apiBaseUrl } from "./api";
import type { ProjectCanvasPreviewTicketResponse } from "./types";

function normalizePreviewPath(relativePath?: string | null): string[] {
  return (relativePath ?? "")
    .split("/")
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0 && segment !== ".");
}

export async function fetchProjectCanvasPreviewTicket(
  projectId: string,
  canvasId: string,
  token: string
): Promise<ProjectCanvasPreviewTicketResponse> {
  const response = await fetch(
    `${apiBaseUrl()}/api/projects/${encodeURIComponent(projectId)}/canvases/${encodeURIComponent(canvasId)}/preview-ticket`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`
      }
    }
  );
  const payload = await response.json().catch(() => null) as Record<string, unknown> | null;
  if (!response.ok) {
    throw new Error(typeof payload?.error === "string" ? payload.error : `HTTP ${response.status}`);
  }
  if (!payload || typeof payload.ticket !== "string") {
    throw new Error("Invalid canvas preview ticket response.");
  }

  return {
    ticket: payload.ticket,
    expiresAt: typeof payload.expiresAt === "string" ? payload.expiresAt : ""
  };
}

// Always names the file: relative URLs in the page resolve against it, so a bare ticket URL would
// make "style.css" lose the ticket segment.
export function buildProjectCanvasPreviewUrl(
  projectId: string,
  canvasId: string,
  ticket: string,
  relativePath: string
): string {
  const encodedSegments = normalizePreviewPath(relativePath).map((segment) => encodeURIComponent(segment));
  const baseUrl = `${apiBaseUrl()}/api/projects/${encodeURIComponent(projectId)}/canvases/${encodeURIComponent(canvasId)}/preview/${encodeURIComponent(ticket)}`;
  return `${baseUrl}/${encodedSegments.length > 0 ? encodedSegments.join("/") : "index.html"}`;
}

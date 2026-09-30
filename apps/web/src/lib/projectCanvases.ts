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

export function buildProjectCanvasPreviewUrl(
  projectId: string,
  canvasId: string,
  ticket: string,
  relativePath?: string | null
): string {
  const encodedSegments = normalizePreviewPath(relativePath).map((segment) => encodeURIComponent(segment));
  const baseUrl = `${apiBaseUrl()}/api/projects/${encodeURIComponent(projectId)}/canvases/${encodeURIComponent(canvasId)}/preview/${encodeURIComponent(ticket)}`;
  return encodedSegments.length > 0 ? `${baseUrl}/${encodedSegments.join("/")}` : baseUrl;
}

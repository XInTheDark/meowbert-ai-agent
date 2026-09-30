import { apiBaseUrl } from "./api";

interface TaskInlineFileTicketResponse {
  ticket: string;
}

function normalizeInlineFilePath(relativePath: string): string[] {
  return relativePath
    .split("/")
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0 && segment !== ".");
}

async function parseTicketResponse(response: Response): Promise<TaskInlineFileTicketResponse> {
  const payload = await response.json().catch(() => null) as Record<string, unknown> | null;
  if (!response.ok) {
    const errorMessage =
      payload && typeof payload.error === "string"
        ? payload.error
        : `HTTP ${response.status}`;
    throw new Error(errorMessage);
  }
  if (!payload || typeof payload.ticket !== "string" || payload.ticket.trim().length === 0) {
    throw new Error("Invalid inline file ticket response.");
  }

  return {
    ticket: payload.ticket
  };
}

export async function fetchTaskInlineFileTicket(taskId: string, token: string): Promise<string> {
  const response = await fetch(`${apiBaseUrl()}/api/tasks/${taskId}/inline-files/ticket`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`
    }
  });
  const payload = await parseTicketResponse(response);
  return payload.ticket;
}

export function buildTaskInlineFileUrl(taskId: string, ticket: string, relativePath: string): string {
  const encodedSegments = normalizeInlineFilePath(relativePath).map((segment) => encodeURIComponent(segment));
  const baseUrl = `${apiBaseUrl()}/api/tasks/${encodeURIComponent(taskId)}/inline-files/${encodeURIComponent(ticket)}`;
  return encodedSegments.length > 0 ? `${baseUrl}/${encodedSegments.join("/")}` : baseUrl;
}

export function buildPublicTaskInlineFileUrl(shareId: string, relativePath: string): string {
  const encodedSegments = normalizeInlineFilePath(relativePath).map((segment) => encodeURIComponent(segment));
  const baseUrl = `${apiBaseUrl()}/api/public/tasks/${encodeURIComponent(shareId)}/inline-files`;
  return encodedSegments.length > 0 ? `${baseUrl}/${encodedSegments.join("/")}` : baseUrl;
}

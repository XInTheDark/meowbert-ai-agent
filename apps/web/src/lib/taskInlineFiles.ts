import { createApiClient, apiBaseUrl } from "./api";

interface TaskInlineFileTicketResponse {
  ticket: string;
}

function normalizeInlineFilePath(relativePath: string): string[] {
  return relativePath
    .split("/")
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0 && segment !== ".");
}

export async function fetchTaskInlineFileTicket(taskId: string, token: string): Promise<string> {
  const payload = await createApiClient(token).post<TaskInlineFileTicketResponse>("/api/tasks/" + taskId + "/inline-files/ticket");
  return payload.ticket;
}

export function buildTaskInlineFileUrl(taskId: string, ticket: string, relativePath: string): string {
  const encodedSegments = normalizeInlineFilePath(relativePath).map((segment) => encodeURIComponent(segment));
  if (ticket.startsWith("device-")) return "meowbert-workspace://files/" + ticket + "/api/tasks/" + encodeURIComponent(taskId) + "/inline-files/device/" + encodedSegments.join("/");
  const baseUrl = `${apiBaseUrl()}/api/tasks/${encodeURIComponent(taskId)}/inline-files/${encodeURIComponent(ticket)}`;
  return encodedSegments.length > 0 ? `${baseUrl}/${encodedSegments.join("/")}` : baseUrl;
}

export function buildPublicTaskInlineFileUrl(shareId: string, relativePath: string): string {
  const encodedSegments = normalizeInlineFilePath(relativePath).map((segment) => encodeURIComponent(segment));
  const baseUrl = `${apiBaseUrl()}/api/public/tasks/${encodeURIComponent(shareId)}/inline-files`;
  return encodedSegments.length > 0 ? `${baseUrl}/${encodedSegments.join("/")}` : baseUrl;
}

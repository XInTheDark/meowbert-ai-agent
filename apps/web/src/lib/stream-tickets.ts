import { apiBaseUrl } from "./api";

interface StreamTicketResponse {
  ticket: string;
}

async function parseTicketResponse(response: Response): Promise<StreamTicketResponse> {
  const payload = await response.json().catch(() => null) as Record<string, unknown> | null;
  if (!response.ok) {
    const errorMessage =
      payload && typeof payload.error === "string"
        ? payload.error
        : `HTTP ${response.status}`;
    throw new Error(errorMessage);
  }
  if (!payload || typeof payload.ticket !== "string" || payload.ticket.trim().length === 0) {
    throw new Error("Invalid stream ticket response.");
  }

  return {
    ticket: payload.ticket
  };
}

async function fetchStreamTicket(path: string, token: string): Promise<string> {
  const response = await fetch(`${apiBaseUrl()}${path}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`
    }
  });
  const payload = await parseTicketResponse(response);
  return payload.ticket;
}

export async function fetchTaskEventStreamTicket(taskId: string, token: string): Promise<string> {
  return fetchStreamTicket(`/api/tasks/${taskId}/events/stream-ticket`, token);
}

export async function fetchDesktopComputerStreamTicket(token: string): Promise<string> {
  return fetchStreamTicket("/api/desktop/computer/stream-ticket", token);
}

export function appendStreamTicket(url: URL | string, ticket: string): string {
  const nextUrl = typeof url === "string" ? new URL(url) : new URL(url.toString());
  nextUrl.searchParams.set("ticket", ticket);
  return nextUrl.toString();
}

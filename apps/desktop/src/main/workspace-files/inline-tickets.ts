import { randomUUID } from "node:crypto";

const tickets = new Map<string, { server: string; taskId: string; expiresAt: number }>();
export function issueDeviceFileTicket(server: string, taskId: string) {
  const ticket = "device-" + randomUUID();
  const expiresAt = Date.now() + 60_000;
  tickets.set(ticket, { server, taskId, expiresAt });
  setTimeout(() => tickets.delete(ticket), 60_000).unref();
  return { ticket, expiresAt: new Date(expiresAt).toISOString() };
}

export function verifyDeviceFileTicket(ticket: string, server: string, taskId: string): boolean {
  const entry = tickets.get(ticket);
  return !!entry && entry.server === server && entry.taskId === taskId && entry.expiresAt > Date.now();
}

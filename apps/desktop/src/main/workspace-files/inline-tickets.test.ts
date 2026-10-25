import { afterEach, expect, it, vi } from "vitest";
import { issueDeviceFileTicket, verifyDeviceFileTicket } from "./inline-tickets";
afterEach(() => vi.useRealTimers());

it("binds native file tickets to one task, server, and short lifetime", async () => {
  vi.useFakeTimers();
  const { ticket } = issueDeviceFileTicket("https://first.test", "task");
  expect(verifyDeviceFileTicket(ticket, "https://first.test", "task")).toBe(true);
  expect(verifyDeviceFileTicket(ticket, "https://second.test", "task")).toBe(false);
  expect(verifyDeviceFileTicket(ticket, "https://first.test", "other-task")).toBe(false);
  expect(issueDeviceFileTicket("https://first.test", "task").ticket).not.toBe(ticket);
  await vi.advanceTimersByTimeAsync(60_000);
  expect(verifyDeviceFileTicket(ticket, "https://first.test", "task")).toBe(false);
});

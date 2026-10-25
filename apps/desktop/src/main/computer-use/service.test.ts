import { expect, it, vi } from "vitest";
vi.mock("../computer", () => ({ performComputerAction: vi.fn() }));
import { createComputerUseService } from "./service";
import type { DesktopComputerActionResult } from "../../shared";

it("shares arbitration and deduplication between local and cloud callers", async () => {
  const perform = vi.fn(async () => ({ ok: true }) as unknown as DesktopComputerActionResult);
  const service = createComputerUseService(perform);
  const input = { toolName: "computer_screenshot" as const, args: {}, taskId: "local", requestId: "action" };
  await Promise.all([service.performAction(input), service.performAction(input)]);
  expect(perform).toHaveBeenCalledOnce();
  await expect(service.performAction({ ...input, taskId: "cloud" })).rejects.toThrow("in use by local");
  service.release("local");
  await service.performAction({ ...input, taskId: "cloud" });
  expect(perform).toHaveBeenCalledTimes(2);
  service.release("cloud");
});

it("does not run queued actions after their lease is fenced", async () => {
  let finish!: (value: DesktopComputerActionResult) => void;
  const perform = vi.fn(() => new Promise<DesktopComputerActionResult>((resolve) => { finish = resolve; }));
  const service = createComputerUseService(perform);
  const input = { toolName: "computer_screenshot" as const, args: {}, taskId: "task" };
  const first = service.performAction(input);
  await vi.waitFor(() => expect(perform).toHaveBeenCalledOnce());
  const queued = service.performAction(input).catch((error: Error) => error.message);
  service.release("task");
  finish({ ok: true } as unknown as DesktopComputerActionResult);
  await first;
  expect(await queued).toContain("fenced");
  expect(perform).toHaveBeenCalledOnce();
});

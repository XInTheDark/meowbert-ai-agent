import type { DesktopComputerActionInput, DesktopComputerActionResult } from "../../shared";
import { isVisualComputerToolName } from "@meowbert/shared";
import { performComputerAction } from "../computer";
import { DeviceTaskLock } from "../device-task-lock";

interface Overlay {
  beforeAction(taskId: string): Promise<void> | void;
  afterAction(taskId: string): Promise<void> | void;
  release(taskId: string): void;
}

export function createComputerUseService(perform = performComputerAction) {
  const lock = new DeviceTaskLock("Computer Use", 90_000);
  const inFlight = new Map<string, Promise<DesktopComputerActionResult>>();
  const recent = new Map<string, DesktopComputerActionResult>();
  let overlay: Overlay | null = null;
  let pending: Promise<unknown> = Promise.resolve();
  const generations = new Map<string, number>();
  const release = (taskId: string) => { generations.set(taskId, (generations.get(taskId) ?? 0) + 1); lock.release(taskId); overlay?.release(taskId); };
  const run = (input: DesktopComputerActionInput, taskId: string) => lock.use(taskId, async () => {
    const visual = isVisualComputerToolName(input.toolName);
    if (visual) await overlay?.beforeAction(taskId);
    try { return await perform(input); }
    finally { if (visual) await overlay?.afterAction(taskId); }
  });
  const performAction = (input: DesktopComputerActionInput): Promise<DesktopComputerActionResult> => {
    const taskId = input.taskId?.trim();
    if (!taskId) return Promise.reject(new Error("Computer Use requires a task id."));
    const key = taskId + ":" + input.requestId;
    if (input.requestId) {
      const cached = recent.get(key);
      if (cached) return Promise.resolve(cached);
      const current = inFlight.get(key);
      if (current) return current;
    }
    // Acquire before queuing so another task cannot slip in between queued actions.
    try { lock.acquire(taskId); } catch (error) { return Promise.reject(error); }
    const generation = generations.get(taskId) ?? 0;
    const result = pending.then(() => {
      if (generation !== (generations.get(taskId) ?? 0)) throw new Error("The Computer Use run has been fenced.");
      return run(input, taskId);
    });
    pending = result.catch(() => undefined);
    if (input.requestId) {
      inFlight.set(key, result);
      void result.then((value) => {
        recent.set(key, value);
        setTimeout(() => recent.delete(key), 30_000).unref();
      }).catch(() => undefined).finally(() => inFlight.delete(key));
    }
    return result;
  };
  return { performAction, release, configureOverlay: (value: Overlay) => { overlay = value; } };
}

export const computerUseService = createComputerUseService();

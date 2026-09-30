import { requestPersistentShellRuntime, type PersistentShellRuntimeState, type PersistentShellRuntimeTarget } from "@meowbert/shared";
import { workerSandboxManager } from "./sandbox.js";

export type { PersistentShellRuntimeState } from "@meowbert/shared";

export function callPersistentShellRuntime<T = PersistentShellRuntimeState>(
  session: PersistentShellRuntimeTarget,
  request: Record<string, unknown>,
  action: "launch" | "request" = "request"
): Promise<T> {
  return requestPersistentShellRuntime<T>(workerSandboxManager, session, request, action);
}

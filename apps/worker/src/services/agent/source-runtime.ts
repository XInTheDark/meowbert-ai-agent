import { assertSourceProviderRuntimeEnabled } from "@meowbert/shared";
import { resolveInternalApiBaseUrl, signInternalScopedAccessTicket } from "./internal-api-proxy.js";

export function buildSourceRuntimeEnv(input: {
  userId: string;
  taskId: string;
  taskDir: string;
  workspaceId: string;
  workspaceRoot: string;
  sourceId: string;
  provider: string;
  ticketScope?: "source_proxy" | "source_reference_proxy";
}): Record<string, string> {
  assertSourceProviderRuntimeEnabled(input.provider);
  return {
    SOURCE_PROXY_BASE_URL: resolveInternalApiBaseUrl(),
    SOURCE_PROXY_TICKET: signInternalScopedAccessTicket({
      scope: input.ticketScope ?? "source_proxy",
      userId: input.userId,
      taskId: input.taskId,
      workspaceId: input.workspaceId,
      sourceId: input.sourceId
    }),
    SOURCE_ID: input.sourceId,
    SOURCE_PROVIDER: input.provider,
    MEOWBERT_TASK_DIR: input.taskDir,
    MEOWBERT_WORKSPACE_ROOT: input.workspaceRoot
  };
}

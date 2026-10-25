import { z } from "zod";
import type { TaskExecutionTarget } from "./task-execution-target.js";

export const workspaceFileHostSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("server"), backendId: z.string().min(1) }).strict(),
  z.object({ kind: z.literal("device"), deviceId: z.string().uuid() }).strict()
]);

export type WorkspaceFileHost = z.infer<typeof workspaceFileHostSchema>;

/** A device workspace can execute only on the device that owns its files. */
export function canTargetReachFileHost(host: WorkspaceFileHost, target: TaskExecutionTarget): boolean {
  if (host.kind === "server") {
    return target.kind === "cloud" || target.kind === "local";
  }
  return target.kind === "local" && target.deviceId === host.deviceId;
}

export function normalizeWorkspaceFileHost(value: unknown, backendId = "local-default"): WorkspaceFileHost {
  return workspaceFileHostSchema.parse(value ?? { kind: "server", backendId });
}

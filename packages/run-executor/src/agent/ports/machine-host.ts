import type { MachineHandle as DockerSandboxHandle } from "@meowbert/shared/docker-sandbox";
import type { RunSandboxResources } from "./run-bootstrap.js";

export interface MachineSpec {
  taskId: string;
  runId: string;
  workspaceId: string;
  environmentId: string;
  actorUserId: string | null;
  taskDir: string;
  taskScratchDir: string;
  envRoot: string;
  workspaceRoot: string;
  workspaceRootRelative?: string;
  envRootRelative?: string;
  storageRoot?: string;
  isThreadTask: boolean;
  skillsRootDir: string | null;
  networkEnabled: boolean;
  runAsRoot: boolean;
  resources: RunSandboxResources;
  // The run's shell environment; later additions apply to commands started afterwards.
  env: Record<string, string>;
  // Quick-mode runs start the sandbox only when the agent first needs it.
  startEagerly: boolean;
  log: (message: string, payload: Record<string, unknown>) => Promise<void>;
}

// Where a run's commands, files and skills execute.
export interface MachineHost {
  // The run's current sandbox; it is replaced transparently if its container crashes.
  readonly sandbox: DockerSandboxHandle;
  initialize(): Promise<{ alreadyInitialized: boolean }>;
  stop(): Promise<void>;
}

export interface MachineProvider {
  // Machine-local scratch space for the task, outside workspace storage.
  prepareScratchDir(input: { workspaceId: string; taskId: string }): Promise<string>;
  start(spec: MachineSpec): Promise<MachineHost>;
}

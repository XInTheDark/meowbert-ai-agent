import type { PlatformModelCompatibilityMode, PlatformModelType } from "@meowbert/shared";
import type { TaskSnapshot } from "../types.js";
import type { TaskLiveSyncFileSummary } from "../live-sync-types.js";
import type { RunToolCallStart } from "./run-control.js";
import type { ProjectMasterTaskAgent } from "../../project-master/task-agent.js";
import type { GoogleWorkspaceRuntimeReference } from "../google-workspace-references.js";

// What the control plane resolves before a run starts. A remote executor receives it when it
// claims the run, with every credential removed from the snapshot.
export interface RunBootstrap {
  fileHost?: import("@meowbert/shared").WorkspaceFileHost;
  snapshot: TaskSnapshot;
  runActorUserId: string | null;
  runActorIsSuperAdmin: boolean;
  runStartedAt: string;
  roots: RunRoots;
  liveSyncFiles: TaskLiveSyncFileSummary[];
  runtime: RunRuntimeRoute;
  memoryEnabled: boolean;
  thoughtPersistenceEnabled: boolean;
  github: RunGitHubAccess;
  sandboxResources: RunSandboxResources;
  googleWorkspaceReferences: GoogleWorkspaceRuntimeReference[];
  hasGoogleWorkspaceFolders: boolean;
  scheduleInfo: RunScheduleInfo | null;
  isProjectMaster: boolean;
  projectMasterTaskAgent: ProjectMasterTaskAgent | null;
  // Tool calls a previous attempt started but never recorded a result for.
  unfinishedToolCalls: RunToolCallStart[];
  inputs?: Array<{ relativePath: string; sizeBytes: number; sha256: string }>;
  sandboxImage?: {
    reference: string;
    digest: string | null;
  };
}

// Absolute workspace and project roots as the executor sees them.
export interface RunRoots {
  workspaceRoot: string;
  envRoot: string;
  // When a remote executor is given a user-mounted backend, these relative paths are used
  // instead of the server's absolute paths. Cloud executors continue to use the absolute roots.
  workspaceRootRelative?: string;
  envRootRelative?: string;
  storageBackendId?: string;
}

// The model route the run was admitted with. Provider credentials stay behind the model gateway.
export interface RunRuntimeRoute {
  providerKind: "platform" | "byo" | "chatgpt";
  providerBaseUrl: string;
  chatGptCodex: boolean;
  supportsNativeCompaction: boolean;
  agentId: string | null;
  isQualityReviewSpecialist: boolean;
  model: string;
  compatibilityModes: PlatformModelCompatibilityMode[];
  modelType: PlatformModelType;
  requestedContextManagementVersion: "v1" | "v2";
  baseEnvironmentJsonPayload: Record<string, unknown>;
  environmentPayload: Record<string, unknown>;
  modelPayload: Record<string, unknown>;
  quickModel: string;
  quickModelCompatibilityModes: PlatformModelCompatibilityMode[];
  maxContextTokens: number;
  quickMode: boolean;
  networkRequestLoggingEnabled: boolean;
}

export interface RunGitHubAccess {
  hasConnection: boolean;
  hasAppConnection: boolean;
  installationAccess: {
    contentsPermission: string | null;
    repositorySelection: string | null;
    canReadContents: boolean;
    canWriteContents: boolean;
  } | null;
  // Shell variables for the connection, minted by the control plane.
  env: Record<string, string>;
}

export interface RunSandboxResources {
  pids?: number;
  memoryMb?: number;
  cpus?: number;
}

export interface RunScheduleInfo {
  mode: "scheduled" | "infinite";
  scheduleState: "active" | "paused" | "cancelled";
  repeat: string | null;
  timezone: string;
  nextRunAt: string | null;
  pendingRun: boolean;
  runTimeoutSeconds: number | null;
  runDeadlineAt: string | null;
}

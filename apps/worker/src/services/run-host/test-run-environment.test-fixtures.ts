import { vi, type Mock } from "vitest";
import type { TaskExecutionJob } from "@meowbert/shared";
import type { OpenAiProviderConfig } from "@meowbert/run-executor/agent/openai-client";
import type { TaskSnapshot } from "@meowbert/run-executor/agent/types";
import type { ModelGateway } from "@meowbert/run-executor/agent/ports/model-gateway";
import type { RunBootstrap } from "@meowbert/run-executor/agent/ports/run-bootstrap";
import type { RunContextStore, RunControl } from "@meowbert/run-executor/agent/ports/run-control";
import type { PlatformToolHost } from "@meowbert/run-executor/agent/ports/platform-tools";
import type { NetworkRequestLogCallback } from "../agent/network-request-log.js";
import type { ServerRunState } from "./bootstrap.js";
import { createDbRunControl, type DbRunControl } from "./db-run-control.js";
import { createDirectModelGateway } from "./direct-model-gateway.js";
import { providerSupportsNativeCompaction } from "@meowbert/run-executor/context-compaction/shared";
import type { ExecutorSettings } from "@meowbert/run-executor/agent/ports/executor-settings";

export const testExecutorSettings: ExecutorSettings = {
  maxSteps: 800,
  commandTimeoutMs: 900_000,
  maxCommandOutputKb: 256,
  shell: "/bin/bash",
  skills: undefined
};

export interface TestRunInput {
  // Shared with the test's execution, so changes to its mode or selection carry over.
  job?: TaskExecutionJob;
  taskId?: string;
  runId?: string;
  workspaceId?: string;
  environmentId?: string;
  actorUserId?: string | null;
  selectionUserId?: string | null;
  mode?: TaskExecutionJob["mode"];
  taskDir?: string;
  envRoot?: string;
  workspaceRoot?: string;
  isProjectMaster?: boolean;
  provider?: OpenAiProviderConfig;
  model?: string;
  quickModel?: string;
  billing?: ServerRunState["billing"];
  quotaExempt?: boolean;
  environmentPayload?: Record<string, unknown>;
  snapshot?: Partial<TaskSnapshot>;
}

function buildTestSnapshot(input: TestRunInput): TaskSnapshot {
  const base = {
    task: {
      id: input.taskId ?? "task-1",
      title: null,
      workspace_id: input.workspaceId ?? "ws-1",
      environment_id: input.environmentId ?? "env-1",
      status: "running",
      source: "web",
      initiator_user_id: input.actorUserId ?? null,
      connector_context_id: null,
      default_timezone: "UTC",
      parent_task_id: null,
      task_root_path: ".meowbert/task-runs/task-1"
    },
    initiator_user: null,
    environment: { id: input.environmentId ?? "env-1", workspace_run_as_root: false }
  };
  return { ...base, ...(input.snapshot ?? {}) } as unknown as TaskSnapshot;
}

// The control plane's state for a run that a test pretends was bootstrapped.
export function createTestServerRunState(input: TestRunInput = {}): ServerRunState {
  const job = input.job ?? {
    taskId: input.taskId ?? "task-1",
    runId: input.runId ?? "run-1",
    selectionUserId: input.selectionUserId ?? undefined,
    mode: input.mode ?? "default"
  } as TaskExecutionJob;
  const snapshot = buildTestSnapshot(input);
  const bootstrap = {
    snapshot,
    runActorUserId: input.actorUserId ?? null,
    runActorIsSuperAdmin: false,
    runStartedAt: new Date(0).toISOString(),
    roots: { envRoot: input.envRoot ?? "/tmp/env", workspaceRoot: input.workspaceRoot ?? "/tmp/workspace" },
    liveSyncFiles: [],
    runtime: {
      providerKind: "platform",
      providerBaseUrl: input.provider?.baseUrl ?? "https://example.com/v1",
      chatGptCodex: input.provider?.chatGptCodex === true,
      supportsNativeCompaction: false,
      agentId: null,
      isQualityReviewSpecialist: false,
      model: input.model ?? "gpt-test",
      compatibilityModes: [],
      modelType: "openai",
      requestedContextManagementVersion: "v1",
      baseEnvironmentJsonPayload: input.environmentPayload ?? {},
      environmentPayload: input.environmentPayload ?? {},
      modelPayload: {},
      quickModel: input.quickModel ?? input.model ?? "gpt-test",
      quickModelCompatibilityModes: [],
      maxContextTokens: 128_000,
      quickMode: false,
      networkRequestLoggingEnabled: false
    },
    memoryEnabled: false,
    thoughtPersistenceEnabled: false,
    github: { hasConnection: false, hasAppConnection: false, installationAccess: null, env: {} },
    sandboxResources: {},
    googleWorkspaceReferences: [],
    hasGoogleWorkspaceFolders: false,
    scheduleInfo: null,
    isProjectMaster: input.isProjectMaster === true,
    projectMasterTaskAgent: null,
    unfinishedToolCalls: []
  } satisfies RunBootstrap;
  return {
    job,
    bootstrap,
    snapshot,
    provider: input.provider ?? { apiKey: "test", baseUrl: "https://example.com/v1" },
    billing: input.billing ?? null,
    quotaExempt: input.quotaExempt === true,
    taskDir: input.taskDir ?? "/tmp/task",
    refreshGitHubToken: async () => ({ ok: false, error: "No GitHub connection is configured for this workspace." })
  };
}

const silentDebugLogger = {
  log: async () => {},
  stage: async <T>(input: { run: () => Promise<T> }) => input.run()
};

// The in-process RunControl over an already bootstrapped run. Messages, events and server tools go
// through the usual modules, so tests mock those; tool-call records and debug mode are stubbed.
export function createTestRunControl(input: TestRunInput = {}): DbRunControl {
  const state = createTestServerRunState(input);
  return {
    ...createDbRunControl(state.job, silentDebugLogger, { state }),
    isDebugEnabled: async () => false,
    recordToolCallStart: async () => {},
    recordToolCallResult: async () => {},
    resolveInterruptedToolCalls: async () => {}
  };
}

export function createTestModelGateway(input: TestRunInput & {
  onNetworkRequest?: NetworkRequestLogCallback;
  reportTurnUsageError?: (message: string) => Promise<void>;
} = {}): ModelGateway {
  const state = createTestServerRunState(input);
  return createDirectModelGateway({
    requireRun: () => state,
    onNetworkRequest: input.onNetworkRequest,
    reportTurnUsageError: input.reportTurnUsageError ?? (async () => {})
  });
}

type Mocked<T> = { [K in keyof T]: T[K] extends (...args: infer A) => infer R ? Mock<(...args: A) => R> : T[K] };

export type FakeRunControl = Omit<Mocked<RunControl>, "context" | "platform"> & {
  context: Mocked<RunContextStore>;
  platform: Mocked<PlatformToolHost>;
};

// Methods created on first use, so a test only sets up what the code under test calls.
function lazyMocks<T extends object>(defaults: Partial<Record<keyof T, (...args: never[]) => unknown>> = {}): Mocked<T> {
  const created = new Map<PropertyKey, Mock>();
  return new Proxy({} as Mocked<T>, {
    get(_target, key) {
      if (typeof key === "symbol" || key === "then") return undefined;
      if (!created.has(key)) {
        const implementation = defaults[key as keyof T];
        created.set(key, implementation ? vi.fn(implementation as (...args: unknown[]) => unknown) : vi.fn(async () => undefined));
      }
      return created.get(key);
    }
  });
}

// A RunControl that records every call, for executor tests that check what the run asked of the
// control plane rather than how the control plane stores it.
export function createFakeRunControl(): FakeRunControl {
  let messageCount = 0;
  const control = lazyMocks<RunControl>({
    appendMessage: () => Promise.resolve(`message-${++messageCount}`),
    setTaskStatus: () => Promise.resolve(true),
    readCancellation: () => Promise.resolve({ cancelRequested: false, latestAttempt: true }),
    watchCancellation: () => () => {},
    consumeCommandInterrupt: () => Promise.resolve(false),
    isDebugEnabled: () => Promise.resolve(false),
    complete: () => Promise.resolve({ updatedStatus: true })
  }) as unknown as FakeRunControl;
  const context = lazyMocks<RunContextStore>({ loadLastCallNumber: () => Promise.resolve(0),
    freezeWindowPrompt: (_window, items) => Promise.resolve(items) });
  const platform = lazyMocks<PlatformToolHost>();
  return new Proxy(control, {
    get(target, key, receiver) {
      if (key === "context") return context;
      if (key === "platform") return platform;
      return Reflect.get(target, key, receiver);
    }
  });
}

// The run-level fields a compaction call takes, for a provider and task.
export function createTestCompactionRuntime(provider: OpenAiProviderConfig, taskId = "task-1") {
  return {
    control: createTestRunControl({ taskId, provider }),
    models: createTestModelGateway({ taskId, provider }),
    supportsNativeCompaction: providerSupportsNativeCompaction(provider)
  };
}

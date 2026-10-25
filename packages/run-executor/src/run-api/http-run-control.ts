import type { RunApiMethod } from "@meowbert/shared";
import type { RunBootstrap } from "../agent/ports/run-bootstrap.js";
import type { RunCancellationState, RunCompletionResult, RunContextStore, RunControl } from "../agent/ports/run-control.js";
import type { PlatformToolHost } from "../agent/ports/platform-tools.js";
import type { RunApiClient } from "./client.js";
import { createRunLeaseKeeper, type RunLeaseKeeperOptions } from "./lease-keeper.js";

const CONTEXT_METHODS = [
  "freezeVersion", "openWindow", "loadWindowItems", "recordItems", "loadNotesSummary", "startNewWindow",
  "linkVisibleMessage", "writeNote", "listWindows", "listItems", "readItem", "searchHistory", "listNotes", "readNote"
] as const satisfies readonly (keyof RunContextStore)[];

const PLATFORM_METHODS = [
  "queryTasks", "viewTaskHistory", "readOrganizedTaskHistory", "searchMemory", "createRecurringTask",
  "editCurrentTaskSchedule", "pauseRecurringSchedule", "applyInfiniteWait", "createSubtask", "startSubtasks",
  "liveSyncStatus", "liveSyncTransfer", "liveSyncFolderSearch", "createProjectCanvas", "recordProjectCanvasEntry",
  "markArtifacts", "unmarkArtifacts", "refreshGitHubToken", "issueSourceAccess", "getDesktopComputerPresence",
  "requestDesktopComputerAction", "persistentShell", "readShellSessionWaitState"
] as const satisfies readonly (keyof PlatformToolHost)[];

// Fails to compile when a store or host method has no Run API call.
type Uncovered<T, Covered> = Exclude<keyof T, Covered>;
const allContextMethodsCovered: Uncovered<RunContextStore, (typeof CONTEXT_METHODS)[number]> extends never ? true : never = true;
const allPlatformMethodsCovered: Uncovered<Omit<PlatformToolHost, "hostShell">, (typeof PLATFORM_METHODS)[number]> extends never ? true : never = true;
void allContextMethodsCovered;
void allPlatformMethodsCovered;

function remoteMethods<T>(client: RunApiClient, prefix: "context" | "platform", names: readonly string[]): T {
  return Object.fromEntries(names.map((name) => [
    name,
    (...args: unknown[]) => client.call(`${prefix}.${name}` as RunApiMethod, args)
  ])) as T;
}

export type HttpRunControlOptions = RunLeaseKeeperOptions;

export interface HttpRunControl extends RunControl {
  // Stops heartbeats and polling; the run's lease then lapses on the server.
  stop(): void;
}

// RunControl over the Run API, for an executor outside the control plane. It holds the run's
// lease from bootstrap until the run completes or fails.
export function createHttpRunControl(client: RunApiClient, options: HttpRunControlOptions = {}): HttpRunControl {
  const lease = createRunLeaseKeeper(client, options);
  let eventSeq = 0;
  const call = (method: RunApiMethod, args: unknown[] = [], extra?: Parameters<RunApiClient["call"]>[2]) => client.call(method, args, extra);

  async function finish<T>(work: Promise<T>): Promise<T> {
    try {
      return await work;
    } finally {
      lease.stop();
    }
  }

  return {
    stop: lease.stop,
    async bootstrap() {
      const bootstrap = await call("control.bootstrap") as RunBootstrap;
      lease.start();
      return bootstrap;
    },
    setTaskStatus: (status) => call("control.setTaskStatus", [status]) as Promise<boolean>,
    readCancellation: () => call("control.readCancellation") as Promise<RunCancellationState>,
    watchCancellation: (watcher) => lease.watch(watcher),
    consumeCommandInterrupt: (step) => call("control.consumeCommandInterrupt", [step]) as Promise<boolean>,
    appendMessage: (input) => call("control.appendMessage", [input], { expectedLeafId: input.parentMessageId }) as Promise<string>,
    selectBranch: async (messageId) => {
      await call("control.selectBranch", [messageId]);
    },
    emitEvent: async (type, payload) => {
      eventSeq += 1;
      await call("control.emitEvent", [type, payload], { seq: eventSeq });
    },
    isDebugEnabled: () => call("control.isDebugEnabled") as Promise<boolean>,
    loadConversationNavigation: (leafMessageId) => call("control.loadConversationNavigation", [leafMessageId]) as ReturnType<RunControl["loadConversationNavigation"]>,
    setGeneratedTitle: async (title) => {
      await call("control.setGeneratedTitle", [title]);
    },
    recordToolCallStart: async (input) => {
      await call("control.recordToolCallStart", [input]);
    },
    recordToolCallResult: async (input) => {
      await call("control.recordToolCallResult", [input]);
    },
    resolveInterruptedToolCalls: async (callIds) => {
      await call("control.resolveInterruptedToolCalls", [callIds]);
    },
    context: remoteMethods<RunContextStore>(client, "context", CONTEXT_METHODS),
    platform: remoteMethods<PlatformToolHost>(client, "platform", PLATFORM_METHODS),
    complete: (completion) => finish(call("control.complete", [completion]) as Promise<RunCompletionResult>),
    fail: async (failure) => {
      await finish(call("control.fail", [failure]));
    }
  };
}

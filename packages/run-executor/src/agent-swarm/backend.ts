import type { ResponseInputItem } from "openai/resources/responses/responses";
import type { ChosenModelRoute, PlatformModelRouter, TaskExecutionJob } from "@meowbert/shared";
import type { TaskRow } from "../agent/types.js";
import type { SwarmBudgetState } from "./budget.js";
import type { ForkSeed, ForkSeedCapabilities } from "./fork-types.js";
import type { SwarmLaneResult, SwarmParkReason } from "./lane-types.js";
import type { SwarmRunContext } from "./run-context.js";

// The run a swarm call is made for. A backend outside the control plane ignores it: the server acts
// for the run whose lease made the call.
export interface SwarmRunRef {
  taskId: string;
  swarm: SwarmRunContext;
}

export interface SwarmInboxRequest {
  // The leader's view of its lanes, at the start of a user turn.
  includeTurnNotes: boolean;
  leafMessageId: string | null;
  // Tool calls of this run not yet stored, written before the inbox so the order survives a restart.
  persistedItems: ResponseInputItem[];
}

// What arrived for the run, already stored on its branch. A stop alone stores nothing.
export interface SwarmInboxAppend {
  leafMessageId: string | null;
  items: ResponseInputItem[];
  laneStopped: boolean;
}

export interface PreparedForkLane {
  taskId: string;
  label: string;
  title: string;
  direction: string | null;
  weight: number;
  modelRoute: ChosenModelRoute | null;
  brief: string;
  // The lane's own result for the fork call.
  forkOutput: ResponseInputItem;
  // Forks from the compacted copy made for lanes on another model.
  crossModel: boolean;
}

export interface CreatedLane {
  taskId: string;
  label: string;
  title: string;
}

// Swarm state lives on the control plane. A run reaches it only through this, in process for cloud
// workers and over the Run API for devices. Refusals the model should see are SwarmToolErrors.
export interface SwarmBackend {
  load(task: TaskRow, routers: PlatformModelRouter[]): Promise<SwarmRunContext | null>;
  loadForkSeed(run: SwarmRunRef): Promise<ForkSeed | null>;
  claimInbox(run: SwarmRunRef, request: SwarmInboxRequest): Promise<SwarmInboxAppend | null>;
  loadBudgetState(run: SwarmRunRef): Promise<SwarmBudgetState | null>;
  markWrapUpNotified(run: SwarmRunRef): Promise<void>;
  hasActiveLanes(run: SwarmRunRef): Promise<boolean>;
  // After each model turn: its cost (when the executor measures it), the lane's automatic notes and step.
  recordTurn(run: SwarmRunRef, input: { weightedTokens: number | null; autoNotes: string[] }): Promise<void>;
  forkLanes(run: SwarmRunRef, input: {
    kind: "split" | "diverge";
    seed: Omit<ForkSeed, "id">;
    crossModelSeed: Omit<ForkSeed, "id"> | null;
    lanes: PreparedForkLane[];
  }): Promise<CreatedLane[]>;
  hasOwnLanes(run: SwarmRunRef): Promise<boolean>;
  loadAutoCheckFiles(run: SwarmRunRef): Promise<string[] | null>;
  loadCheckInputs(run: SwarmRunRef, leafMessageId: string | null): Promise<{ userMessages: string[]; spinePath: string | null }>;
  startCheckLane(run: SwarmRunRef, input: {
    laneTaskId: string;
    brief: string;
    capabilities: ForkSeedCapabilities;
    focus: string | null;
    modelRoute: ChosenModelRoute | null;
  }): Promise<CreatedLane>;
  steerLane(run: SwarmRunRef, input: { laneTaskId: string; message: string }): Promise<void>;
  stopLane(run: SwarmRunRef, input: { laneTaskId: string; discard: boolean }): Promise<void>;
  resumeLane(run: SwarmRunRef, input: { laneTaskId: string; message: string; extraTokens: number | null }): Promise<{ title: string }>;
  shareNote(run: SwarmRunRef, text: string): Promise<void>;
  emitEvent(run: SwarmRunRef, message: string): Promise<void>;
  // Ends the run and keeps its job to resume once the barrier is met. A remote backend sends only the
  // branch; the server resumes the job it admitted.
  park(run: SwarmRunRef, input: { job: TaskExecutionJob; leafMessageId: string | null; reason: SwarmParkReason }): Promise<void>;
  finishLane(run: SwarmRunRef, input: { runId: string; status: "done" | "failed"; result: SwarmLaneResult }): Promise<void>;
}

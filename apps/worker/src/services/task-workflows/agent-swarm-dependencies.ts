import type { TaskExecutionJob } from "@meowbert/shared";
import { asObject, clampNonNegativeInteger, coerceNullableString } from "./shared.js";

export interface StoredSwarmPause {
  swarmNodeId: string | null;
  sinceMessageNo: number;
  status: string;
  // Agents this one waits for; it resumes once every one of them has finished its current work.
  waitingForTaskIds: string[];
  finishedTaskIds: string[];
  triggerSource: TaskExecutionJob["triggerSource"];
  selectionUserId: string | null;
  mode: "agent_swarm_leader" | "agent_swarm_worker";
}

export type StoredSwarmPauseMap = Record<string, StoredSwarmPause>;

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

export function parseSwarmPauses(state: Record<string, unknown>): StoredSwarmPauseMap {
  const pauses: StoredSwarmPauseMap = {};
  for (const [taskId, rawPause] of Object.entries(asObject(state.pausedSwarmAgents))) {
    const pause = asObject(rawPause);
    const triggerSource = pause.triggerSource;
    const mode = pause.mode;
    if (
      !["web", "telegram", "discord", "github", "email"].includes(String(triggerSource))
      || (mode !== "agent_swarm_leader" && mode !== "agent_swarm_worker")
    ) continue;

    pauses[taskId] = {
      swarmNodeId: coerceNullableString(pause.swarmNodeId),
      sinceMessageNo: clampNonNegativeInteger(pause.sinceMessageNo),
      status: coerceNullableString(pause.status) ?? "Paused.",
      waitingForTaskIds: stringList(pause.waitingForTaskIds),
      finishedTaskIds: stringList(pause.finishedTaskIds),
      triggerSource: triggerSource as TaskExecutionJob["triggerSource"],
      selectionUserId: coerceNullableString(pause.selectionUserId),
      mode
    };
  }
  return pauses;
}

export function outstandingSwarmDependencies(pause: StoredSwarmPause): string[] {
  return pause.waitingForTaskIds.filter((id) => !pause.finishedTaskIds.includes(id));
}

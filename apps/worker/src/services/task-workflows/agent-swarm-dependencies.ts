import type { TaskExecutionJob } from "@meowbert/shared";
import { asObject, clampNonNegativeInteger, coerceNullableString } from "./shared.js";

export interface StoredSwarmPause {
  swarmNodeId: string | null;
  sinceMessageNo: number;
  status: string;
  waitingForTaskIds: string[];
  expectedReportTaskIds: string[];
  receivedReportTaskIds: string[];
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
      expectedReportTaskIds: stringList(pause.expectedReportTaskIds),
      receivedReportTaskIds: stringList(pause.receivedReportTaskIds),
      triggerSource: triggerSource as TaskExecutionJob["triggerSource"],
      selectionUserId: coerceNullableString(pause.selectionUserId),
      mode
    };
  }
  return pauses;
}

export function outstandingSwarmDependencies(pause: StoredSwarmPause): string[] {
  return Array.from(new Set([
    ...pause.waitingForTaskIds,
    ...pause.expectedReportTaskIds.filter((id) => !pause.receivedReportTaskIds.includes(id))
  ]));
}

export function findSwarmWaitCycle(pauses: StoredSwarmPauseMap, preferredTaskId?: string): string[] | null {
  const visited = new Set<string>();
  const path: string[] = [];
  const onPath = new Map<string, number>();

  const visit = (taskId: string): string[] | null => {
    const existingIndex = onPath.get(taskId);
    if (existingIndex !== undefined) return [...path.slice(existingIndex), taskId];
    if (visited.has(taskId)) return null;
    visited.add(taskId);
    onPath.set(taskId, path.length);
    path.push(taskId);
    for (const dependencyId of outstandingSwarmDependencies(pauses[taskId])) {
      if (!pauses[dependencyId]) continue;
      const cycle = visit(dependencyId);
      if (cycle) return cycle;
    }
    path.pop();
    onPath.delete(taskId);
    return null;
  };

  const taskIds = Object.keys(pauses).sort();
  if (preferredTaskId && pauses[preferredTaskId]) {
    taskIds.splice(taskIds.indexOf(preferredTaskId), 1);
    taskIds.unshift(preferredTaskId);
  }
  for (const taskId of taskIds) {
    const cycle = visit(taskId);
    if (cycle) return cycle;
  }
  return null;
}

import type { TaskExecutionJob } from "@meowbert/shared";

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

export function outstandingSwarmDependencies(pause: StoredSwarmPause): string[] {
  return pause.waitingForTaskIds.filter((id) => !pause.finishedTaskIds.includes(id));
}

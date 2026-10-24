import { insertSwarmNote } from "./notes-store.js";
import type { SwarmLaneRow } from "./lane-store.js";
import { formatActivityNotes, type SwarmActivity } from "@meowbert/run-executor/agent-swarm/activity";

// One note per category for the step, then the collector starts over.
export async function flushAutoNotes(lane: Pick<SwarmLaneRow, "task_id" | "swarm_task_id" | "parent_task_id">, activity: SwarmActivity): Promise<void> {
  const notes = formatActivityNotes(activity);
  activity.wrote.length = 0;
  activity.searched.length = 0;
  activity.opened.length = 0;
  for (const content of notes) {
    await insertSwarmNote({
      swarmTaskId: lane.swarm_task_id,
      authorTaskId: lane.task_id,
      scopeParentTaskId: lane.parent_task_id,
      kind: "auto",
      content
    });
  }
}

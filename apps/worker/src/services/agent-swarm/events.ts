import { emitTaskEvent } from "../runtime/events.js";

// Lane changes reach the task page through the swarm root's event stream; the page then refetches
// the lane tree. Sent after the change has committed.
export async function emitSwarmEvent(swarmTaskId: string, message: string, payload: Record<string, unknown> = {}): Promise<void> {
  try {
    await emitTaskEvent(swarmTaskId, "log", { message, phase: "swarm_lane", ...payload });
  } catch (error) {
    console.warn(`[agent-swarm] Failed to emit a lane event for ${swarmTaskId}`, error);
  }
}

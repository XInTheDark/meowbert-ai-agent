import { redis } from "../../lib/redis.js";

const MEMORY_SYNTHESIS_EVENT_CHANNEL = "memory_synthesis_ready";

export async function publishMemorySynthesisEvent(input: {
  workspaceId: string;
  environmentId: string;
}): Promise<void> {
  try {
    await redis.publish(MEMORY_SYNTHESIS_EVENT_CHANNEL, JSON.stringify(input));
  } catch (error) {
    console.error("Unable to publish memory synthesis event", error);
  }
}

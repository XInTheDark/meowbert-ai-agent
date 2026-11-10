import type { RunApiMethod } from "@meowbert/shared";
import type { SwarmBackend } from "../agent-swarm/backend.js";
import { createSwarmActivity } from "../agent-swarm/activity.js";
import type { SwarmRunContext } from "../agent-swarm/run-context.js";
import { SwarmToolError } from "../agent-swarm/tool-error.js";
import type { RunApiClient } from "./client.js";

type SwarmMethod = Extract<RunApiMethod, `swarm.${string}`>;

// Swarm state over the Run API. The server acts for the run whose lease makes the call, so the run
// reference each method takes stays on this side; refusals come back as SwarmToolErrors.
export function createHttpSwarmBackend(client: RunApiClient): SwarmBackend {
  async function call<T>(method: SwarmMethod, input: object = {}): Promise<T> {
    const reply = await client.call(method, [input]) as { ok?: T; refused?: string } | null;
    if (reply?.refused !== undefined) throw new SwarmToolError(reply.refused);
    return reply?.ok as T;
  }

  return {
    async load() {
      const swarm = await call<SwarmRunContext | null>("swarm.load");
      return swarm ? { ...swarm, forcedSubmitReason: null, budgetNoteSent: false, activity: createSwarmActivity() } : null;
    },
    loadForkSeed: () => call("swarm.loadForkSeed"),
    claimInbox: (_run, request) => call("swarm.claimInbox", request),
    loadBudgetState: () => call("swarm.loadBudgetState"),
    markWrapUpNotified: () => call("swarm.markWrapUpNotified"),
    hasActiveLanes: () => call("swarm.hasActiveLanes"),
    // The model proxy charges the turn's cost; only the lane's notes go up.
    recordTurn: (_run, input) => call("swarm.recordTurn", { autoNotes: input.autoNotes }),
    forkLanes: (_run, input) => call("swarm.forkLanes", input),
    hasOwnLanes: () => call("swarm.hasOwnLanes"),
    loadAutoCheckFiles: () => call("swarm.loadAutoCheckFiles"),
    loadCheckInputs: (_run, leafMessageId) => call("swarm.loadCheckInputs", { leafMessageId }),
    startCheckLane: (_run, input) => call("swarm.startCheckLane", input),
    steerLane: (_run, input) => call("swarm.steerLane", input),
    stopLane: (_run, input) => call("swarm.stopLane", input),
    resumeLane: (_run, input) => call("swarm.resumeLane", input),
    shareNote: (_run, text) => call("swarm.shareNote", { text }),
    emitEvent: (_run, message) => call("swarm.emitEvent", { message }),
    park: (_run, input) => call("swarm.park", { leafMessageId: input.leafMessageId, reason: input.reason }),
    finishLane: (_run, input) => call("swarm.finishLane", { status: input.status, result: input.result })
  };
}

import { SHARE_TOOL_NAME, SPLIT_TOOL_NAME, SUBMIT_TOOL_NAME } from "../../../agent-tools/swarm.js";
import { swarmDepth, type SwarmRunContext } from "../../../agent-swarm/config.js";

// Roles are enforced here, never by removing tools: a fork's tools array must match its parent's.
// Returns the error the model sees, or null when the caller may use the tool.
export function checkSwarmToolRole(toolName: string, swarm: SwarmRunContext | null | undefined): string | null {
  if (!swarm) return "Swarm tools are only available in an Agent Swarm task.";
  const lane = swarm.lane;
  switch (toolName) {
    case SPLIT_TOOL_NAME:
      if (lane?.kind === "check") return "Check lanes cannot split.";
      if (swarmDepth(swarm) >= swarm.settings.advanced.maxDepth) return "Maximum depth reached. Do this part yourself.";
      return null;
    case SHARE_TOOL_NAME:
      if (!lane) return "Only lanes can share notes.";
      if (lane.kind === "check") return "Check lanes do not share notes.";
      return null;
    case SUBMIT_TOOL_NAME:
      return lane ? null : "Only lanes can submit. Reply to the user with final_response.";
    default:
      return null;
  }
}

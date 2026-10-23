import {
  CHECK_TOOL_NAME,
  DIVERGE_TOOL_NAME,
  RESUME_TOOL_NAME,
  SHARE_TOOL_NAME,
  SPLIT_TOOL_NAME,
  STEER_TOOL_NAME,
  STOP_LANE_TOOL_NAME,
  SUBMIT_TOOL_NAME
} from "../../../agent-tools/swarm.js";
import { swarmDepth, type SwarmRunContext } from "../../../agent-swarm/config.js";

// Roles are enforced here, never by removing tools: a fork's tools array must match its parent's.
// Returns the error the model sees, or null when the caller may use the tool. Whether the caller owns
// a lane, or has lanes of its own to check, is checked by the handler against the database.
export function checkSwarmToolRole(toolName: string, swarm: SwarmRunContext | null | undefined): string | null {
  if (!swarm) return "Swarm tools are only available in an Agent Swarm task.";
  const lane = swarm.lane;
  const atMaxDepth = swarmDepth(swarm) >= swarm.settings.advanced.maxDepth;
  switch (toolName) {
    case SPLIT_TOOL_NAME:
      if (lane?.kind === "check") return "Check lanes cannot split.";
      if (atMaxDepth) return "Maximum depth reached. Do this part yourself.";
      return null;
    case DIVERGE_TOOL_NAME:
      if (lane?.kind === "check") return "Check lanes cannot diverge.";
      if (swarm.withinDiverge) return "You are answering a diverge question, so you cannot diverge again. Split instead.";
      if (atMaxDepth) return "Maximum depth reached. Do this part yourself.";
      return null;
    case CHECK_TOOL_NAME:
    case STEER_TOOL_NAME:
    case STOP_LANE_TOOL_NAME:
    case RESUME_TOOL_NAME:
      return lane?.kind === "check" ? "Check lanes have no lanes of their own." : null;
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

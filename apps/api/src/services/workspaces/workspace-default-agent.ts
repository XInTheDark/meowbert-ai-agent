import {
  findPlatformAgentPresetById,
  getWorkspaceDefaultAgentId,
  isPlatformAgentPresetDefaultEligible
} from "@meowbert/shared";
import { query } from "../../lib/db.js";
import { getVisiblePlatformAgentsForUser } from "../platform/platform-agents.js";

export async function loadWorkspaceDefaultAgentId(workspaceId: string): Promise<string | null> {
  const result = await query<{ model_defaults_json: Record<string, unknown> | null }>(
    "SELECT model_defaults_json FROM workspace_settings WHERE workspace_id = $1",
    [workspaceId]
  );
  return getWorkspaceDefaultAgentId(result.rows[0]?.model_defaults_json);
}

export async function canUseAsWorkspaceDefaultAgent(userId: string, agentId: string): Promise<boolean> {
  const { presets } = await getVisiblePlatformAgentsForUser(userId);
  const preset = findPlatformAgentPresetById(presets, agentId);
  return preset !== null && isPlatformAgentPresetDefaultEligible(preset);
}

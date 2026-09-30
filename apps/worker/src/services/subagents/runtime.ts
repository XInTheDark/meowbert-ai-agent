import { findPlatformAgentPresetById, resolvePlatformAgentPresetMode, type PlatformAgentPreset } from "@meowbert/shared";
import { query } from "../../lib/db.js";
import { extractModelRequestPayload } from "../agent/utils.js";
import type { OpenAiProviderConfig } from "../agent/openai-client.js";
import type { SubagentRuntime } from "./types.js";

export async function loadSubagentRuntime(taskId: string): Promise<SubagentRuntime | null> {
  const result = await query<{ runtime_json: SubagentRuntime }>(
    "SELECT runtime_json FROM task_subagent_sessions WHERE task_id = $1", [taskId]
  );
  return result.rows[0]?.runtime_json ?? null;
}

export function chooseSubagentRuntime(input: {
  parent: SubagentRuntime;
  tier: "default" | "fast";
  fastAgentId: string | null;
  presets: PlatformAgentPreset[];
}): SubagentRuntime {
  if (input.tier === "default") return structuredClone(input.parent);
  const preset = findPlatformAgentPresetById(input.presets, input.fastAgentId);
  if (!preset || resolvePlatformAgentPresetMode(preset) !== "standard" || typeof preset.payload.model !== "string") {
    throw new Error("Configure subagentFastAgent with an ordinary Agent Preset before using Fast.");
  }
  return {
    model: preset.payload.model,
    payload: extractModelRequestPayload(preset.payload),
    provider: { ...input.parent.provider }
  };
}

export async function loadSubagentPlatformProvider(baseUrl: string): Promise<OpenAiProviderConfig> {
  const result = await query<{ base_url: string; api_key: string }>(
    "SELECT base_url, api_key FROM ai_providers WHERE base_url = $1 LIMIT 1", [baseUrl]
  );
  if (!result.rows[0]) throw new Error("The subagent's AI provider no longer exists.");
  return { baseUrl: result.rows[0].base_url, apiKey: result.rows[0].api_key, supportsNativeCompaction: true };
}

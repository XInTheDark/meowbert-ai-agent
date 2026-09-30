import {
  findPlatformAgentPresetById,
  resolveWorkspaceDefaultAgentId,
  type PlatformAgentPreset
} from "@meowbert/shared";
import type { TaskMessageRow } from "./types.js";
import { pickRunAgentSelection } from "./utils.js";

function resolveAgentPresetByIdOrDefault(
  agentId: string | null | undefined,
  visibleAgentPresets: PlatformAgentPreset[],
  workspaceDefaultAgentId: string | null = null
): PlatformAgentPreset | null {
  const defaultAgentId = resolveWorkspaceDefaultAgentId(visibleAgentPresets, workspaceDefaultAgentId);
  const effectiveAgentId = agentId ?? defaultAgentId;
  if (!effectiveAgentId) {
    return null;
  }

  return (
    findPlatformAgentPresetById(visibleAgentPresets, effectiveAgentId)
    ?? (defaultAgentId ? findPlatformAgentPresetById(visibleAgentPresets, defaultAgentId) : null)
  );
}

export function resolveEffectiveRunAgentPreset(
  messages: TaskMessageRow[],
  visibleAgentPresets: PlatformAgentPreset[],
  workspaceDefaultAgentId: string | null = null
): PlatformAgentPreset | null {
  return resolveAgentPresetByIdOrDefault(pickRunAgentSelection(messages)?.id, visibleAgentPresets, workspaceDefaultAgentId);
}

export function resolveMemorySynthesisAgentPreset(
  memorySynthesisAgentId: string | null,
  visibleAgentPresets: PlatformAgentPreset[]
): PlatformAgentPreset | null {
  return resolveAgentPresetByIdOrDefault(memorySynthesisAgentId, visibleAgentPresets);
}

export function resolveReviewerAgentPreset(
  reviewerAgentId: string | null,
  visibleAgentPresets: PlatformAgentPreset[]
): PlatformAgentPreset | null {
  return resolveAgentPresetByIdOrDefault(reviewerAgentId, visibleAgentPresets);
}

import type { ResponseInputItem } from "openai/resources/responses/responses";
import { getToolGroupSummary } from "../agent-tools/index.js";
import { appendPromptEnvelopeDelta, type PromptEnvelope } from "./prompt-envelope.js";
import type { PreparedAgentRunContext } from "./runtime.js";
import { getSkillEntry, type SkillSummary } from "./skill-registry.js";
import { buildOnDemandSkillsPromptDelta, buildSkillEnabledPromptDelta, findSkillsEnabledInHistory } from "./skill-prompt.js";

type EnableSkill = (skillId: string) => Promise<{ doc: string | null; toolNames: string[] }>;

export interface RunCapabilityInput {
  prepared: PreparedAgentRunContext;
  promptEnvelope: PromptEnvelope;
  // enable_skill entry point for this run, including on-demand built-in tool groups.
  enableSkillById: EnableSkill;
  onDemandCapabilities: SkillSummary[];
  conversationItems: ResponseInputItem[];
}

function isExpectedEnableFailure(message: string): boolean {
  return message.startsWith("Skill not found:") || message.startsWith("Skill disabled in server config:");
}

async function autoEnableSelectedSkills(input: RunCapabilityInput): Promise<void> {
  for (const skillId of input.prepared.runToolOptions.enabledSkills) {
    try {
      const enabledSkill = await input.enableSkillById(skillId);
      appendPromptEnvelopeDelta(input.promptEnvelope, {
        reason: "skill_enabled",
        role: "system",
        runScoped: true,
        content: buildSkillEnabledPromptDelta({ skillId, doc: enabledSkill.doc, toolNames: enabledSkill.toolNames })
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!isExpectedEnableFailure(message)) {
        console.warn(`Failed to auto-enable skill ${skillId}: ${message}`);
      }
    }
  }
}

async function autoEnableSelectedSources(input: RunCapabilityInput): Promise<void> {
  for (const sourceId of input.prepared.runToolOptions.enabledSources) {
    try {
      const enabledSource = await input.prepared.enableSourceById(sourceId);
      appendPromptEnvelopeDelta(input.promptEnvelope, {
        reason: "skill_enabled",
        role: "system",
        runScoped: true,
        content: buildSkillEnabledPromptDelta({
          skillId: sourceId,
          doc: enabledSource.doc,
          toolNames: enabledSource.toolNames,
          kindLabel: "Source"
        })
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!message.startsWith("Source not found:")) {
        console.warn(`Failed to auto-enable source ${sourceId}: ${message}`);
      }
    }
  }
}

// History already carries these skills' prompt updates, so only their tools come back.
async function restoreSkillsEnabledInHistory(input: RunCapabilityInput): Promise<void> {
  const selected = new Set(input.prepared.runToolOptions.enabledSkills);
  for (const skillId of findSkillsEnabledInHistory(input.conversationItems)) {
    if (selected.has(skillId)) continue;
    try {
      await input.enableSkillById(skillId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!isExpectedEnableFailure(message)) {
        console.warn(`Failed to restore skill ${skillId}: ${message}`);
      }
    }
  }
}

// Skills and built-in tool groups this run offers without loading them, for the prompt hint and list_skills.
export function resolveOnDemandCapabilities(prepared: PreparedAgentRunContext, onDemandToolGroups: string[]): SkillSummary[] {
  // The Project Master has no enable_skill tool.
  if (prepared.isProjectMaster === true) return [];
  const skills = prepared.onDemandSkills.flatMap((skillId) => {
    const manifest = prepared.skillsRootDir ? getSkillEntry(prepared.skillsRootDir, skillId)?.manifest : undefined;
    return manifest ? [{ id: skillId, name: manifest.name, description: manifest.description }] : [];
  });
  const toolGroups = onDemandToolGroups.flatMap((groupId) => {
    const summary = getToolGroupSummary(groupId);
    return summary ? [{ id: groupId, ...summary }] : [];
  });
  return [...skills, ...toolGroups];
}

// Listed on every run, restored or not, so the cached prompt prefix stays the same across runs.
function announceOnDemandCapabilities(input: RunCapabilityInput): void {
  if (input.onDemandCapabilities.length === 0) return;
  appendPromptEnvelopeDelta(input.promptEnvelope, {
    reason: "on-demand-skills",
    role: "system",
    runScoped: true,
    content: buildOnDemandSkillsPromptDelta(input.onDemandCapabilities)
  });
}

export async function enableRunCapabilities(input: RunCapabilityInput): Promise<void> {
  announceOnDemandCapabilities(input);
  if (input.prepared.skillsRootDir) {
    await autoEnableSelectedSkills(input);
    await autoEnableSelectedSources(input);
  }
  await restoreSkillsEnabledInHistory(input);
}

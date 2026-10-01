import type { ResponseInputItem } from "openai/resources/responses/responses";

const PROMPT_UPDATE_PREFIX = "[Prompt update] ";

export function buildSkillEnabledPromptDelta(input: {
  skillId: string;
  doc: string | null;
  toolNames: string[];
  kindLabel?: string;
}): string {
  const kindLabel = input.kindLabel ?? "Skill";
  const sections = [`${PROMPT_UPDATE_PREFIX}${kindLabel} enabled: ${input.skillId}`];

  sections.push("", "New function tools:");
  if (input.toolNames.length > 0) {
    sections.push(
      input.toolNames.map((toolName) => `- ${toolName}`).join("\n"),
      "",
      "If these tools are relevant, prefer using them directly instead of repeating setup work."
    );
  } else {
    sections.push("- none");
  }

  if (input.doc) {
    sections.push("", `${kindLabel} guidance:`, input.doc);
  }

  return sections.join("\n");
}

export function buildOnDemandSkillsPromptDelta(skills: Array<{ id: string; description: string }>): string {
  return [
    "These skills are available without being loaded. Call `enable_skill` with the ID before you need its tools:",
    ...skills.map((skill) => `- \`${skill.id}\`: ${skill.description}`)
  ].join("\n");
}

function promptItemText(item: ResponseInputItem): string | null {
  const record = item as { role?: unknown; content?: unknown };
  if (record.role !== "system" && record.role !== "developer") return null;
  if (typeof record.content === "string") return record.content;
  if (!Array.isArray(record.content)) return null;
  const first = record.content[0] as { text?: unknown } | undefined;
  return typeof first?.text === "string" ? first.text : null;
}

// Skills enabled in earlier runs leave their prompt update in history. Restoring them keeps the tools
// the conversation says exist, and the tool list (part of the cached prefix) matches the last run.
export function findSkillsEnabledInHistory(items: ResponseInputItem[]): string[] {
  const marker = `${PROMPT_UPDATE_PREFIX}Skill enabled: `;
  const skillIds = new Set<string>();
  for (const item of items) {
    const text = promptItemText(item);
    if (!text?.startsWith(marker)) continue;
    const skillId = text.slice(marker.length).split("\n", 1)[0].trim();
    if (skillId.length > 0) skillIds.add(skillId);
  }
  return [...skillIds];
}

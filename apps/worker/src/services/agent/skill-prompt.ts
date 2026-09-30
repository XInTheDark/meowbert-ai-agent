import { buildCanvasDesignGuidance } from "./design-guidance.js";

const CANVAS_DESIGN_GUIDANCE_MARKER = "{{CANVAS_DESIGN_GUIDANCE}}";

function buildSkillDocument(skillId: string, doc: string | null): string | null {
  if (!doc || skillId !== "html-canvas") {
    return doc;
  }

  return doc.replace(CANVAS_DESIGN_GUIDANCE_MARKER, buildCanvasDesignGuidance());
}

export function buildSkillEnabledPromptDelta(input: {
  skillId: string;
  doc: string | null;
  toolNames: string[];
  kindLabel?: string;
}): string {
  const kindLabel = input.kindLabel ?? "Skill";
  const skillDoc = buildSkillDocument(input.skillId, input.doc);
  const sections = [`[Prompt update] ${kindLabel} enabled: ${input.skillId}`];

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

  if (skillDoc) {
    sections.push("", `${kindLabel} guidance:`, skillDoc);
  }

  return sections.join("\n");
}

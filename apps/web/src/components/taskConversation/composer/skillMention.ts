import { parseCitationSegments, type Citation } from "./citationToken";

const SKILL_PATH_PREFIX = "skill:";

export function isSkillPath(path: string | undefined): path is string {
  return path !== undefined && path.startsWith(SKILL_PATH_PREFIX) && path.length > SKILL_PATH_PREFIX.length;
}

// A skill mention is a citation whose target is `skill:<id>`, so it stays plain text in drafts and messages.
export function buildSkillCitation(skill: { id: string; name: string }): Citation {
  return { label: skill.name, path: `${SKILL_PATH_PREFIX}${skill.id}` };
}

export function findMentionedSkillIds(text: string): string[] {
  const ids = parseCitationSegments(text, isSkillPath).flatMap((segment) => (
    segment.kind === "citation" ? [segment.citation.path.slice(SKILL_PATH_PREFIX.length)] : []
  ));
  return [...new Set(ids)];
}

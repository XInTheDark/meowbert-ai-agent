import { MenuOption } from "@lexical/react/LexicalTypeaheadMenuPlugin";
import type { TaskAttachment } from "../../../lib/types";
import type { Citation } from "./citationToken";
import { buildSkillCitation } from "./skillMention";
import { toCitation } from "./useComposerCitations";

export interface MentionSkill {
  id: string;
  name: string;
}

export class ComposerMentionOption extends MenuOption {
  citation: Citation;
  typeLabel: string;

  constructor(key: string, citation: Citation, typeLabel: string) {
    super(key);
    this.citation = citation;
    this.typeLabel = typeLabel;
  }
}

function matchesQuery(query: string, ...values: string[]): boolean {
  const normalizedQuery = query.trim().toLowerCase();
  return values.some((value) => value.toLowerCase().includes(normalizedQuery));
}

export function buildMentionOptions(query: string, attachments: TaskAttachment[], skills: MentionSkill[]): ComposerMentionOption[] {
  const fileOptions = attachments.flatMap((attachment) => {
    const citation = toCitation(attachment);
    return citation && matchesQuery(query, attachment.label)
      ? [new ComposerMentionOption(`file:${attachment.id}`, citation, "Attached file")]
      : [];
  });
  const skillOptions = skills
    .filter((skill) => matchesQuery(query, skill.name, skill.id))
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((skill) => new ComposerMentionOption(`skill:${skill.id}`, buildSkillCitation(skill), "Skill"));
  return [...fileOptions, ...skillOptions];
}

const MENTION_TRIGGER = /(^|\s)@([^\n@]{0,60})$/;

export function findMentionMatch(textBeforeCaret: string): { leadOffset: number; matchingString: string; replaceableString: string } | null {
  const match = MENTION_TRIGGER.exec(textBeforeCaret);
  if (!match) return null;
  return {
    leadOffset: match.index + match[1].length,
    matchingString: match[2],
    replaceableString: `@${match[2]}`
  };
}

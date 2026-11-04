import { useEffect, useRef } from "react";
import type { TaskToolOptions } from "../../../lib/types";
import { findMentionedSkillIds } from "./skillMention";

// Keeps every skill mentioned in the draft switched on, including pills restored from a draft or pasted in.
export function useSkillMentionSync(input: {
  value: string;
  availableSkillIds: string[];
  toolOptions: TaskToolOptions | undefined;
  onToolOptionsChange: ((options: TaskToolOptions) => void) | undefined;
}): void {
  const latest = useRef(input);
  latest.current = input;
  const availableKey = input.availableSkillIds.join("\n");
  const enabledKey = input.toolOptions?.enabledSkills.join("\n");

  useEffect(() => {
    const { value, availableSkillIds, toolOptions, onToolOptionsChange } = latest.current;
    if (!toolOptions || !onToolOptionsChange) return;
    const missing = findMentionedSkillIds(value)
      .filter((id) => availableSkillIds.includes(id) && !toolOptions.enabledSkills.includes(id));
    if (missing.length === 0) return;
    onToolOptionsChange({ ...toolOptions, enabledSkills: [...toolOptions.enabledSkills, ...missing] });
  }, [input.value, availableKey, enabledKey]);
}

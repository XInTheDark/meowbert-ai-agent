import { ToolOptionsDropdown, type SkillSummary } from "../tasks/ToolOptionsDropdown";
import type { TaskToolOptions } from "../../lib/types";

interface WorkspaceToolsetSettingsSectionProps {
  disabled: boolean;
  toolset: TaskToolOptions;
  availableSkills: SkillSummary[];
  onChange: (toolset: TaskToolOptions) => void;
}

export function WorkspaceToolsetSettingsSection(props: WorkspaceToolsetSettingsSectionProps) {
  return (
    <div>
      <strong>Toolset</strong>
      <p className="hint-text">
        These tools are enabled automatically for new chats in this workspace. Memory follows the Workspace Memory setting.
      </p>
      <ToolOptionsDropdown
        toolOptions={props.toolset}
        onChange={props.onChange}
        availableSkills={props.availableSkills}
        showMemorySearch={false}
        showComputerUse={false}
        disabled={props.disabled}
        variant="button"
        label="Toolset"
      />
    </div>
  );
}

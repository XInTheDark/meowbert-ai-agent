import type { ProjectSuggestedAction } from "@meowbert/shared/memory";
import type { ApiClient } from "../../../lib/api";
import { SuggestedActionPills } from "../../../project/suggestedActions/SuggestedActionPills";
import { useProjectSuggestedActions } from "../../../project/suggestedActions/useProjectSuggestedActions";

// The project's suggested actions as chips above the Master's input, offered only while the input is empty.
export function ProjectMasterComposerSuggestions(props: {
  api: ApiClient;
  workspaceId: string | null;
  projectId: string | null;
  visible: boolean;
  onSelect: (action: ProjectSuggestedAction) => void;
}) {
  const actions = useProjectSuggestedActions(props.api, props.workspaceId, props.projectId);
  if (!props.visible) return null;
  return (
    <SuggestedActionPills
      actions={actions}
      onSelect={props.onSelect}
      className="task-composer-starters project-master-composer-suggestions"
    />
  );
}

import type { AgentSummary } from "../../../components/tasks/AgentDropdown";
import type { SkillSummary } from "../../../components/tasks/ToolOptionsDropdown";

export interface EnvironmentOption {
  id: string;
  name: string;
}

export interface ConnectorPanelSharedProps {
  activeEnvironments: EnvironmentOption[];
  availableAgents: AgentSummary[];
  availableSkills: SkillSummary[];
  defaultAgentId: string | null;
  isLoading: boolean;
  isSaving: boolean;
  loadError: string | null;
  saveError: string | null;
  canManageConnectors: boolean;
  workspaceMemoryEnabled: boolean;
  onRefresh: () => void;
}

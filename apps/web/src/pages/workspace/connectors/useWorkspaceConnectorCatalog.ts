import { useEffect, useState } from "react";
import type { ApiClient } from "../../../lib/api";
import type { AgentSummary } from "../../../components/tasks/AgentDropdown";
import type { SkillSummary } from "../../../components/tasks/ToolOptionsDropdown";

interface WorkspaceConnectorCatalog {
  availableAgents: AgentSummary[];
  availableSkills: SkillSummary[];
  defaultAgentId: string | null;
}

export function useWorkspaceConnectorCatalog(api: ApiClient, activeWorkspaceId: string): WorkspaceConnectorCatalog {
  const [availableAgents, setAvailableAgents] = useState<AgentSummary[]>([]);
  const [availableSkills, setAvailableSkills] = useState<SkillSummary[]>([]);
  const [defaultAgentId, setDefaultAgentId] = useState<string | null>(null);

  useEffect(() => {
    void api.get<{ skills: SkillSummary[] }>("/api/skills")
      .then((response) => setAvailableSkills(response.skills))
      .catch(() => setAvailableSkills([]));
  }, [activeWorkspaceId, api]);

  useEffect(() => {
    void api.get<{ agents: AgentSummary[]; defaultAgentId: string | null }>(
      `/api/agents?workspaceId=${encodeURIComponent(activeWorkspaceId)}`
    )
      .then((response) => {
        setAvailableAgents(response.agents);
        setDefaultAgentId(response.defaultAgentId);
      })
      .catch(() => {
        setAvailableAgents([]);
        setDefaultAgentId(null);
      });
  }, [activeWorkspaceId, api]);

  return {
    availableAgents,
    availableSkills,
    defaultAgentId
  };
}

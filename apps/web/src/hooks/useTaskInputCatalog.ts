import { useEffect, useMemo, useState } from "react";
import type { ApiClient } from "../lib/api";
import { API_CACHE_TTLS } from "../lib/api-cache";
import type { AgentSummary } from "../components/tasks/AgentDropdown";
import type { SkillSummary } from "../components/tasks/ToolOptionsDropdown";
import {
  canAttachWorkspaceSource,
  type WorkspaceSourceListResponse,
  type WorkspaceSourceSummary
} from "../sources/sourceTypes";

interface TaskInputCatalog {
  availableAgents: AgentSummary[];
  availableSkills: SkillSummary[];
  availableSources: WorkspaceSourceSummary[];
  attachableSources: WorkspaceSourceSummary[];
  defaultAgentId: string | null;
  modelSliderAgentIds?: string[];
}

export function useTaskInputCatalog(api: ApiClient | null, workspaceId: string | null, isSuperAdmin = false): TaskInputCatalog {
  const [availableAgents, setAvailableAgents] = useState<AgentSummary[]>([]);
  const [availableSkills, setAvailableSkills] = useState<SkillSummary[]>([]);
  const [availableSources, setAvailableSources] = useState<WorkspaceSourceSummary[]>([]);
  const [defaultAgentId, setDefaultAgentId] = useState<string | null>(null);
  const [modelSliderAgentIds, setModelSliderAgentIds] = useState<string[] | undefined>(undefined);

  useEffect(() => {
    if (!api) {
      setAvailableSkills([]);
      return;
    }

    const snapshot = api.cachedGet?.<{ skills: SkillSummary[] }>("/api/skills", { ttlMs: API_CACHE_TTLS.catalog });
    if (snapshot?.data) {
      setAvailableSkills(snapshot.data.skills);
    }

    void (snapshot?.promise ?? api.get<{ skills: SkillSummary[] }>("/api/skills"))
      .then((response) => setAvailableSkills(response.skills))
      .catch(() => setAvailableSkills([]));
  }, [api, workspaceId]);

  useEffect(() => {
    if (!api) {
      setAvailableAgents([]);
      setDefaultAgentId(null);
      setModelSliderAgentIds(undefined);
      return;
    }

    const agentsPath = workspaceId ? `/api/agents?workspaceId=${encodeURIComponent(workspaceId)}` : "/api/agents";
    const snapshot = api.cachedGet?.<{ agents: AgentSummary[]; defaultAgentId: string | null; modelSliderAgentIds?: string[] }>(
      agentsPath,
      { ttlMs: API_CACHE_TTLS.catalog }
    );
    if (snapshot?.data) {
      setAvailableAgents(snapshot.data.agents);
      setDefaultAgentId(snapshot.data.defaultAgentId);
      setModelSliderAgentIds(isSuperAdmin ? snapshot.data.modelSliderAgentIds : undefined);
    }

    void (snapshot?.promise ?? api.get<{ agents: AgentSummary[]; defaultAgentId: string | null; modelSliderAgentIds?: string[] }>(agentsPath))
      .then((response) => {
        setAvailableAgents(response.agents);
        setDefaultAgentId(response.defaultAgentId);
        setModelSliderAgentIds(isSuperAdmin ? response.modelSliderAgentIds : undefined);
      })
      .catch(() => {
        setAvailableAgents([]);
        setDefaultAgentId(null);
        setModelSliderAgentIds(undefined);
      });
  }, [api, isSuperAdmin, workspaceId]);

  useEffect(() => {
    if (!api || !workspaceId) {
      setAvailableSources([]);
      return;
    }

    const path = `/api/workspaces/${workspaceId}/sources`;
    const snapshot = api.cachedGet?.<WorkspaceSourceListResponse>(path, { ttlMs: API_CACHE_TTLS.catalog });
    if (snapshot?.data) {
      setAvailableSources(snapshot.data.sources);
    }

    void (snapshot?.promise ?? api.get<WorkspaceSourceListResponse>(path))
      .then((response) => setAvailableSources(response.sources))
      .catch(() => setAvailableSources([]));
  }, [api, workspaceId]);

  const attachableSources = useMemo(
    () => availableSources.filter((source) => canAttachWorkspaceSource(source)),
    [availableSources]
  );

  return {
    availableAgents,
    availableSkills,
    availableSources,
    attachableSources,
    defaultAgentId,
    modelSliderAgentIds
  };
}

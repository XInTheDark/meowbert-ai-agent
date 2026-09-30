import { useEffect, useState } from "react";
import type { ApiClient } from "../../lib/api";
import type { AgentSummary } from "../tasks/AgentDropdown";

const PLATFORM_DEFAULT_VALUE = "__platform_default__";

interface AgentCatalogResponse {
  agents: AgentSummary[];
  platformDefaultAgentId?: string | null;
}

export function WorkspaceDefaultAgentSetting(props: {
  api: ApiClient;
  workspaceId: string;
  value: string | null;
  disabled: boolean;
  onChange: (agentId: string | null) => void;
}) {
  const [catalog, setCatalog] = useState<AgentCatalogResponse | null>(null);

  useEffect(() => {
    let cancelled = false;
    void props.api.get<AgentCatalogResponse>(`/api/agents?workspaceId=${encodeURIComponent(props.workspaceId)}`)
      .then((response) => { if (!cancelled) setCatalog(response); })
      .catch(() => { if (!cancelled) setCatalog({ agents: [] }); });
    return () => { cancelled = true; };
  }, [props.api, props.workspaceId]);

  // Swarms are always picked explicitly, so they cannot be the implicit default.
  const agents = (catalog?.agents ?? []).filter((agent) => (agent.mode ?? "standard") === "standard");
  const platformDefault = agents.find((agent) => agent.id === catalog?.platformDefaultAgentId);
  const selectedIsListed = props.value !== null && agents.some((agent) => agent.id === props.value);

  return (
    <label>
      <strong>Default agent</strong>
      <p className="hint-text">Used for new tasks and messages when no agent is picked, including tasks started by connectors or the Project Master.</p>
      <select
        value={props.value ?? PLATFORM_DEFAULT_VALUE}
        onChange={(event) => props.onChange(event.target.value === PLATFORM_DEFAULT_VALUE ? null : event.target.value)}
        disabled={props.disabled || catalog === null}
      >
        <option value={PLATFORM_DEFAULT_VALUE}>
          {platformDefault ? `Platform default (${platformDefault.name})` : "Platform default"}
        </option>
        {props.value !== null && !selectedIsListed && catalog !== null ? (
          <option value={props.value}>{props.value} (unavailable)</option>
        ) : null}
        {agents.map((agent) => (
          <option key={agent.id} value={agent.id}>{agent.name}</option>
        ))}
      </select>
    </label>
  );
}

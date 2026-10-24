import {
  AGENT_SWARM_SPAWN_EFFORT_MAX,
  AGENT_SWARM_SPAWN_EFFORT_MIN,
  normalizeAgentSwarmSpawnEffort
} from "@meowbert/shared/agent-swarm-config";

const EFFORT_LABELS = ["Minimal", "Low", "Balanced", "High", "Maximum"];

interface AgentSwarmEffortSliderProps {
  value: number;
  disabled?: boolean;
  onChange: (value: number) => void;
}

export function agentSwarmEffortLabel(value: number): string {
  return EFFORT_LABELS[normalizeAgentSwarmSpawnEffort(value) - AGENT_SWARM_SPAWN_EFFORT_MIN] ?? "Balanced";
}

export function AgentSwarmEffortSlider(props: AgentSwarmEffortSliderProps) {
  const value = normalizeAgentSwarmSpawnEffort(props.value);
  return (
    <label className="task-parameters-field">
      <span>Effort: {agentSwarmEffortLabel(value)}</span>
      <input
        type="range"
        min={AGENT_SWARM_SPAWN_EFFORT_MIN}
        max={AGENT_SWARM_SPAWN_EFFORT_MAX}
        step="1"
        value={value}
        disabled={props.disabled}
        aria-label="Agent Swarm spawn effort"
        onChange={(event) => props.onChange(Number(event.target.value))}
      />
      <small>How readily the leader delegates work to lanes.</small>
    </label>
  );
}

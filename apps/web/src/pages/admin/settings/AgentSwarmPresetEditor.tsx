import { useMemo, useState } from "react";
import { AgentSwarmAdvancedFields } from "../../../components/tasks/AgentSwarmAdvancedFields";
import { AgentSwarmEffortSlider } from "../../../components/tasks/AgentSwarmEffortSlider";
import {
  applySwarmPresetForm,
  buildEmptySwarmPresetForm,
  listLeaderOptions,
  listRouterIds,
  listSwarmPresetForms,
  type SwarmPresetForm
} from "./swarmPresetDraft";

interface AgentSwarmPresetEditorProps {
  agentPresetsDraft: string;
  modelRoutersDraft: string;
  onAgentPresetsDraftChange: (value: string) => void;
}

const NEW_PRESET = "";

// Plain fields for an Agent Swarm preset; applying writes it into the presets JSON above, which is
// saved with the rest of the settings.
export function AgentSwarmPresetEditor(props: AgentSwarmPresetEditorProps) {
  const presets = useMemo(() => listSwarmPresetForms(props.agentPresetsDraft), [props.agentPresetsDraft]);
  const leaders = useMemo(() => listLeaderOptions(props.agentPresetsDraft), [props.agentPresetsDraft]);
  const routers = useMemo(() => listRouterIds(props.modelRoutersDraft), [props.modelRoutersDraft]);
  const [selectedId, setSelectedId] = useState(NEW_PRESET);
  const [form, setForm] = useState<SwarmPresetForm>(buildEmptySwarmPresetForm);
  const [message, setMessage] = useState<{ error: boolean; text: string } | null>(null);
  const set = <K extends keyof SwarmPresetForm>(key: K, value: SwarmPresetForm[K]) => setForm((current) => ({ ...current, [key]: value }));

  const select = (id: string) => {
    setSelectedId(id);
    setMessage(null);
    setForm(presets.find((preset) => preset.id === id) ?? buildEmptySwarmPresetForm());
  };
  const apply = () => {
    const result = applySwarmPresetForm(props.agentPresetsDraft, form, selectedId || null);
    if (result.error !== null) {
      setMessage({ error: true, text: result.error });
      return;
    }
    props.onAgentPresetsDraftChange(result.json);
    setSelectedId(form.id.trim().toLowerCase());
    setMessage({ error: false, text: "Applied to the presets above. Save settings to keep it." });
  };

  return (
    <div className="stack-form agent-swarm-preset-editor" style={{ gap: "0.6rem" }}>
      <strong>Agent Swarm preset</strong>
      <label className="task-parameters-field">
        <span>Preset</span>
        <select value={selectedId} onChange={(event) => select(event.target.value)}>
          <option value={NEW_PRESET}>New swarm preset</option>
          {presets.map((preset) => <option key={preset.id} value={preset.id}>{preset.name || preset.id}</option>)}
        </select>
      </label>
      <label className="task-parameters-field"><span>ID</span>
        <input value={form.id} onChange={(event) => set("id", event.target.value)} placeholder="research-swarm" /></label>
      <label className="task-parameters-field"><span>Name</span>
        <input value={form.name} onChange={(event) => set("name", event.target.value)} placeholder="Research Swarm" /></label>
      <label className="task-parameters-field"><span>Description</span>
        <input value={form.description} onChange={(event) => set("description", event.target.value)} /></label>
      <label className="task-parameters-field"><span>Leader agent</span>
        <select value={form.leaderAgentId} onChange={(event) => set("leaderAgentId", event.target.value)}>
          <option value="">Pick a single agent</option>
          {leaders.map((leader) => <option key={leader.id} value={leader.id}>{leader.name}</option>)}
        </select>
      </label>
      {routers.length > 0 ? (
        <label className="task-parameters-field"><span>Lane model router</span>
          <select value={form.routerId} onChange={(event) => set("routerId", event.target.value)}>
            <option value="">None: lanes use the leader's model</option>
            {routers.map((router) => <option key={router} value={router}>{router}</option>)}
          </select>
        </label>
      ) : null}
      <AgentSwarmEffortSlider value={form.spawnEffort} onChange={(value) => set("spawnEffort", value)} />
      <label className="task-parameters-toggle">
        <input type="checkbox" checked={form.budgetsEnabled} onChange={(event) => set("budgetsEnabled", event.target.checked)} />
        <span><strong>Budgets</strong><small>Share one token and time budget across the leader and its lanes.</small></span>
      </label>
      {form.budgetsEnabled ? (
        <>
          <label className="task-parameters-field"><span>Token budget</span>
            <input type="number" value={form.tokenBudget} onChange={(event) => set("tokenBudget", event.target.value)} placeholder="10000000" /></label>
          <label className="task-parameters-field"><span>Time budget (minutes)</span>
            <input type="number" value={form.timeBudgetMinutes} onChange={(event) => set("timeBudgetMinutes", event.target.value)} placeholder="No deadline" /></label>
        </>
      ) : null}
      <AgentSwarmAdvancedFields draft={form.advanced} budgetsEnabled={form.budgetsEnabled} onChange={(advanced) => set("advanced", advanced)} />
      {message ? <p className={message.error ? "error-text" : "hint-text"} style={{ margin: 0 }}>{message.text}</p> : null}
      <div className="row-actions">
        <button type="button" className="btn ghost" onClick={apply}>Apply to presets</button>
      </div>
    </div>
  );
}

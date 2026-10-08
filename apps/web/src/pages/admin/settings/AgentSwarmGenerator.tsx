import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, Copy, Plus, Trash2, X } from "lucide-react";
import { AGENT_SWARM_MAX_TIME_BUDGET_MINUTES, AGENT_SWARM_MAX_TOKEN_BUDGET } from "@meowbert/shared/agent-swarm";
import { AGENT_SWARM_DEFAULT_TOKEN_BUDGET } from "@meowbert/shared/agent-swarm-quota";
import { copyTextToClipboard } from "./adminSettingsDrafts";
import {
  createSwarmDraft,
  parseSwarmModelOptions,
  validateGeneratedSwarmPresets,
  type SwarmDraft,
  type SwarmModelOption,
  type SwarmSeat
} from "./swarmGeneratorDraft";
import "./agent-swarm-generator.css";

function updateSwarm(root: SwarmDraft, key: string, update: (node: SwarmDraft) => SwarmDraft): SwarmDraft {
  if (root.key === key) return update(root);
  const updateSeat = (seat: SwarmSeat): SwarmSeat => seat.kind === "swarm"
    ? { kind: "swarm", swarm: updateSwarm(seat.swarm, key, update) }
    : seat;
  return {
    ...root,
    leader: root.leader ? updateSeat(root.leader) : null,
    workers: root.workers.map(updateSeat)
  };
}

function ModelSelect(props: {
  value: string;
  models: SwarmModelOption[];
  label: string;
  onChange: (id: string) => void;
}) {
  return (
    <select aria-label={props.label} value={props.value} onChange={(event) => props.onChange(event.target.value)}>
      <option value="">Choose model</option>
      {props.models.map((model) => <option key={model.id} value={model.id}>{model.name} ({model.id})</option>)}
    </select>
  );
}

interface SwarmNodeEditorProps {
  node: SwarmDraft;
  depth: number;
  models: SwarmModelOption[];
  onUpdate: (key: string, update: (node: SwarmDraft) => SwarmDraft) => void;
  onNewSwarm: () => SwarmDraft;
  onRemove?: () => void;
}

function SwarmSeatEditor(props: {
  seat: SwarmSeat;
  label: string;
  models: SwarmModelOption[];
  depth: number;
  onChange: (seat: SwarmSeat) => void;
  onRemove: () => void;
  onNewSwarm: () => SwarmDraft;
  onUpdate: SwarmNodeEditorProps["onUpdate"];
}) {
  if (props.seat.kind === "swarm") {
    return <SwarmNodeEditor node={props.seat.swarm} depth={props.depth + 1} models={props.models}
      onUpdate={props.onUpdate} onNewSwarm={props.onNewSwarm} onRemove={props.onRemove} />;
  }
  return (
    <div className="swarm-generator-seat">
      <span className="swarm-generator-seat-label">{props.label}</span>
      <ModelSelect label={`${props.label} model`} models={props.models} value={props.seat.agentId}
        onChange={(agentId) => props.onChange({ kind: "model", agentId })} />
      <button type="button" className="btn ghost icon-btn" title="Remove model" aria-label={`Remove ${props.label}`}
        onClick={props.onRemove}><Trash2 size={15} /></button>
    </div>
  );
}

function parseBudgetInput(value: string): number | null {
  const parsed = Number(value);
  return value.trim() && Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : null;
}

function SwarmBudgetEditor(props: { node: SwarmDraft; onChange: (update: (node: SwarmDraft) => SwarmDraft) => void }) {
  const { node, onChange } = props;
  return (
    <>
      <div className="swarm-generator-fields">
        <label>Token budget<input type="number" min={1} max={AGENT_SWARM_MAX_TOKEN_BUDGET} step={1000}
          placeholder={String(AGENT_SWARM_DEFAULT_TOKEN_BUDGET)} value={node.tokenBudget ?? ""}
          disabled={node.disableSpawningAndBudgets}
          onChange={(event) => onChange((entry) => ({ ...entry, tokenBudget: parseBudgetInput(event.target.value) }))} /></label>
        <label>Time budget (minutes)<input type="number" min={1} max={AGENT_SWARM_MAX_TIME_BUDGET_MINUTES}
          placeholder="No deadline" value={node.timeBudgetMinutes ?? ""} disabled={node.disableSpawningAndBudgets}
          onChange={(event) => onChange((entry) => ({ ...entry, timeBudgetMinutes: parseBudgetInput(event.target.value) }))} /></label>
      </div>
      <label className="swarm-generator-spawnable">
        <input type="checkbox" checked={node.disableSpawningAndBudgets}
          onChange={(event) => onChange((entry) => ({ ...entry, disableSpawningAndBudgets: event.target.checked }))} />
        Disable spawning and budgets
      </label>
    </>
  );
}

function SwarmNodeEditor(props: SwarmNodeEditorProps) {
  const { node, onUpdate } = props;
  const hasNestedSwarm = node.leader?.kind === "swarm" || node.workers.some((seat) => seat.kind === "swarm");
  const change = (update: (entry: SwarmDraft) => SwarmDraft) => onUpdate(node.key, update);
  const addWorker = (seat: SwarmSeat) => change((entry) => ({ ...entry, workers: [...entry.workers, seat] }));
  const replaceWorker = (index: number, seat: SwarmSeat) => change((entry) => ({
    ...entry, workers: entry.workers.map((item, at) => at === index ? seat : item)
  }));
  const removeWorker = (index: number) => change((entry) => ({
    ...entry, workers: entry.workers.filter((_, at) => at !== index)
  }));
  return (
    <section className="swarm-generator-node" aria-label={node.name || "Swarm"}>
      <div className="swarm-generator-node-head">
        <strong>{props.depth === 0 ? "Root swarm" : "Nested swarm"}</strong>
        {props.onRemove ? <button type="button" className="btn ghost icon-btn" title="Remove swarm"
          aria-label={`Remove swarm ${node.name}`} onClick={props.onRemove}><Trash2 size={15} /></button> : null}
      </div>
      <div className="swarm-generator-fields">
        <label>ID<input maxLength={240} value={node.id} onChange={(event) => change((entry) => ({ ...entry, id: event.target.value }))} /></label>
        <label>Name<input maxLength={240} value={node.name} onChange={(event) => change((entry) => ({ ...entry, name: event.target.value }))} /></label>
        <label>Review rounds<input type="number" min={0} max={10} value={node.reviewRounds}
          onChange={(event) => change((entry) => ({ ...entry, reviewRounds: Number(event.target.value) }))} /></label>
      </div>
      <label className="swarm-generator-description">Description
        <input maxLength={240} value={node.description} onChange={(event) => change((entry) => ({ ...entry, description: event.target.value }))} />
      </label>
      {props.depth === 0 ? <SwarmBudgetEditor node={node} onChange={change} /> : null}
      <label className="swarm-generator-spawnable">
        <input type="checkbox" checked={node.spawnableAsNode && !hasNestedSwarm} disabled={hasNestedSwarm}
          onChange={(event) => change((entry) => ({ ...entry, spawnableAsNode: event.target.checked }))} />
        Spawnable node type
      </label>
      <div className="swarm-generator-roster">
        <strong>Leader</strong>
        {node.leader ? <SwarmSeatEditor seat={node.leader} label="Leader" models={props.models} depth={props.depth}
          onUpdate={onUpdate} onNewSwarm={props.onNewSwarm}
          onChange={(seat) => change((entry) => ({ ...entry, leader: seat }))}
          onRemove={() => change((entry) => ({ ...entry, leader: null }))} /> : (
          <div className="swarm-generator-actions">
            <button type="button" className="btn ghost" onClick={() => change((entry) => ({ ...entry, leader: { kind: "model", agentId: "" } }))}>
              <Plus size={15} /> Model
            </button>
            {props.depth < 2 ? <button type="button" className="btn ghost" onClick={() => change((entry) => ({
              ...entry, leader: { kind: "swarm", swarm: props.onNewSwarm() }
            }))}><Plus size={15} /> Swarm</button> : null}
          </div>
        )}
        <strong>Workers</strong>
        {node.workers.map((seat, index) => <SwarmSeatEditor key={seat.kind === "swarm" ? seat.swarm.key : `model-${index}`}
          seat={seat} label={`Worker ${index + 1}`} models={props.models} depth={props.depth}
          onUpdate={onUpdate} onNewSwarm={props.onNewSwarm}
          onChange={(next) => replaceWorker(index, next)} onRemove={() => removeWorker(index)} />)}
        <div className="swarm-generator-actions">
          <button type="button" className="btn ghost" onClick={() => addWorker({ kind: "model", agentId: "" })}>
            <Plus size={15} /> Model
          </button>
          {props.depth < 2 ? <button type="button" className="btn ghost" onClick={() => addWorker({
            kind: "swarm", swarm: props.onNewSwarm()
          })}><Plus size={15} /> Swarm</button> : null}
        </div>
      </div>
    </section>
  );
}

export function AgentSwarmGenerator(props: {
  agentPresetsDraft: string;
  onInsert: (value: string) => void;
  onClose: () => void;
}) {
  const nextKey = useRef(1);
  const [root, setRoot] = useState(() => createSwarmDraft("swarm-0"));
  const [copyStatus, setCopyStatus] = useState("");
  const models = useMemo(() => parseSwarmModelOptions(props.agentPresetsDraft), [props.agentPresetsDraft]);
  const reservedIds = useMemo(() => {
    try {
      const parsed = JSON.parse(props.agentPresetsDraft) as unknown;
      return Array.isArray(parsed) ? parsed.flatMap((entry) => typeof entry?.id === "string" ? [entry.id] : []) : [];
    } catch { return []; }
  }, [props.agentPresetsDraft]);
  const generated = useMemo(() => {
    try {
      const presets = validateGeneratedSwarmPresets(root, models, reservedIds);
      return { json: JSON.stringify(presets, null, 2), error: null };
    } catch (error) {
      return { json: "", error: error instanceof Error ? error.message : String(error) };
    }
  }, [root, models, reservedIds]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") props.onClose(); };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [props.onClose]);

  function insertPresets() {
    if (!generated.json) return;
    const existing = JSON.parse(props.agentPresetsDraft) as unknown[];
    const additions = JSON.parse(generated.json) as unknown[];
    props.onInsert(JSON.stringify([...existing, ...additions], null, 2));
    props.onClose();
  }

  return createPortal(
    <div className="agent-swarm-generator-backdrop" onClick={props.onClose}>
      <div className="agent-swarm-generator-dialog" role="dialog" aria-modal="true" aria-labelledby="swarm-generator-title"
        onClick={(event) => event.stopPropagation()}>
        <header className="agent-swarm-generator-header">
          <h2 id="swarm-generator-title">Agent swarm generator</h2>
          <button type="button" className="btn ghost icon-btn" title="Close" aria-label="Close generator"
            onClick={props.onClose}><X size={18} /></button>
        </header>
        <div className="agent-swarm-generator-body">
          <div className="agent-swarm-generator-tree">
            <SwarmNodeEditor node={root} depth={0} models={models}
              onUpdate={(key, update) => { setRoot((current) => updateSwarm(current, key, update)); setCopyStatus(""); }}
              onNewSwarm={() => {
                const index = nextKey.current++;
                return createSwarmDraft(`swarm-${index}`, index + 1);
              }} />
          </div>
          <section className="agent-swarm-generator-output" aria-label="Generated configuration">
            <div className="agent-swarm-generator-output-head">
              <strong>Generated presets</strong>
              <div className="swarm-generator-actions">
                <button type="button" className="btn ghost" disabled={!generated.json}
                  onClick={() => void copyTextToClipboard(generated.json).then((copied) => setCopyStatus(copied ? "Copied" : "Copy failed"))}>
                  {copyStatus === "Copied" ? <Check size={15} /> : <Copy size={15} />} {copyStatus || "Copy"}
                </button>
                <button type="button" className="btn primary" disabled={!generated.json} onClick={insertPresets}>
                  <Plus size={15} /> Add to agent presets
                </button>
              </div>
            </div>
            {generated.error ? <p className="error-text" role="status">{generated.error}</p> : null}
            <textarea readOnly spellCheck={false} aria-label="Generated agent preset JSON" value={generated.json} />
          </section>
        </div>
      </div>
    </div>, document.body
  );
}

import type { FormEvent } from "react";
import { DraftNumberInput } from "../../../components/forms/DraftNumberInput";

interface ModelSettingsTabProps {
  usageRateMultiplier: number;
  modelMetadataDraft: string;
  modelRoutersDraft: string;
  modelSliderAgentIdsDraft: string;
  agentPresetsDraft: string;
  specializedModelsDraft: string;
  isSaving: boolean;
  hasSettings: boolean;
  error: string | null;
  onUsageRateMultiplierChange: (value: number) => void;
  onModelMetadataDraftChange: (value: string) => void;
  onModelRoutersDraftChange: (value: string) => void;
  onModelSliderAgentIdsDraftChange: (value: string) => void;
  onAgentPresetsDraftChange: (value: string) => void;
  onSpecializedModelsDraftChange: (value: string) => void;
  onSubmit: (event: FormEvent) => Promise<void>;
}

export function ModelSettingsTab(props: ModelSettingsTabProps) {
  return (
    <form className="stack-form" style={{ marginTop: "1rem" }} onSubmit={(event) => void props.onSubmit(event)}>
      <div className="stack-form" style={{ gap: "0.6rem" }}>
        <strong>Estimated cost usage</strong>
        <p className="muted-text" style={{ marginTop: 0 }}>
          Usage is calculated from model metadata multipliers for <code>input_tokens</code>,{" "}
          <code>cached_input_tokens</code>, <code>cache_write_input_tokens</code>, <code>output_tokens</code>, and{" "}
          <code>reasoning_tokens</code>.
        </p>
        <div style={{ display: "flex", gap: "1rem", alignItems: "center", flexWrap: "wrap" }}>
          <label style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
            <span>Global rate multiplier</span>
            <DraftNumberInput
              mode="decimal"
              min={0}
              step={0.01}
              value={props.usageRateMultiplier}
              onValueChange={props.onUsageRateMultiplierChange}
              style={{ width: "8rem" }}
            />
          </label>
        </div>
      </div>

      <label style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
        <strong>Model metadata (JSON object)</strong>
        <textarea
          spellCheck={false}
          value={props.modelMetadataDraft}
          onChange={(event) => props.onModelMetadataDraftChange(event.target.value)}
          rows={12}
        />
      </label>

      <label style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
        <strong>Model routers (JSON array)</strong>
        <textarea
          spellCheck={false}
          value={props.modelRoutersDraft}
          onChange={(event) => props.onModelRoutersDraftChange(event.target.value)}
          rows={12}
        />
      </label>

      <label style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
        <strong>Specialized runtime (JSON object)</strong>
        <textarea
          spellCheck={false}
          value={props.specializedModelsDraft}
          onChange={(event) => props.onSpecializedModelsDraftChange(event.target.value)}
          rows={5}
        />
        <p className="hint-text" style={{ marginTop: 0 }}>
          Use <code>internalModel</code> for background work like task titles and connector routing, <code>fastModel</code> for quick task work, <code>memorySynthesisAgent</code> for Memory refresh tasks, <code>reviewerAgent</code> for Quality control reviewers, and <code>subagentFastAgent</code> for Fast subagents. The agent settings are Agent Preset IDs and apply the preset's full payload. Leave <code>subagentFastAgent</code> null until configured; other null values use their defaults.
        </p>
      </label>

      <label style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
        <strong>Model slider IDs (JSON array)</strong>
        <textarea
          spellCheck={false}
          value={props.modelSliderAgentIdsDraft}
          onChange={(event) => props.onModelSliderAgentIdsDraftChange(event.target.value)}
          rows={5}
        />
        <p className="hint-text" style={{ marginTop: 0 }}>
          Super admins see these picker IDs in the slider order. Leave the list empty to use every visible preset in its configured order. Regular users keep the full list.
        </p>
      </label>

      <div style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
        <strong>Agent presets (JSON array)</strong>
        <textarea
          aria-label="Agent presets (JSON array)"
          spellCheck={false}
          value={props.agentPresetsDraft}
          onChange={(event) => props.onAgentPresetsDraftChange(event.target.value)}
          rows={12}
        />
        <p className="hint-text" style={{ marginTop: 0 }}>
          An Agent Swarm preset sets <code>mode</code> to <code>agent_swarm</code> and names a single-agent <code>leaderAgentId</code>. It can also set <code>routerId</code>, <code>budgetsEnabled</code>, <code>tokenBudget</code>, <code>timeBudgetMinutes</code> and an <code>advanced</code> object with lane limits.
        </p>
      </div>

      {props.error ? <p className="error-text">{props.error}</p> : null}

      <div className="row-actions">
        <button className="btn primary" type="submit" disabled={props.isSaving || !props.hasSettings}>
          {props.isSaving ? "Saving..." : "Save Settings"}
        </button>
      </div>
    </form>
  );
}

import { useMemo, useState } from "react";
import type { ReasoningEffortChoice, SelectedSetupModel } from "./adminSetupPresets";

const REASONING_OPTIONS: Array<{ value: ReasoningEffortChoice; label: string }> = [
  { value: "off", label: "No reasoning" },
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" }
];

export function AdminSetupModelsStep(props: {
  availableModels: string[];
  selected: SelectedSetupModel[];
  onChange: (selected: SelectedSetupModel[]) => void;
  onNext: () => void;
}) {
  const [filter, setFilter] = useState("");
  const [customModel, setCustomModel] = useState("");
  const selectedIds = new Set(props.selected.map((model) => model.modelId));
  const visibleModels = useMemo(() => {
    const query = filter.trim().toLowerCase();
    return props.availableModels.filter((id) => !selectedIds.has(id) && id.toLowerCase().includes(query)).slice(0, 50);
  }, [filter, props.availableModels, props.selected]);

  const add = (modelId: string) => {
    const trimmed = modelId.trim();
    if (trimmed && !selectedIds.has(trimmed)) {
      props.onChange([...props.selected, { modelId: trimmed, reasoningEffort: "medium" }]);
    }
  };
  const update = (modelId: string, patch: Partial<SelectedSetupModel>) =>
    props.onChange(props.selected.map((model) => (model.modelId === modelId ? { ...model, ...patch } : model)));
  const remove = (modelId: string) => props.onChange(props.selected.filter((model) => model.modelId !== modelId));
  const makeDefault = (modelId: string) =>
    props.onChange([...props.selected.filter((model) => model.modelId === modelId), ...props.selected.filter((model) => model.modelId !== modelId)]);

  return (
    <div className="stack-form">
      <p className="muted-text" style={{ margin: 0 }}>
        Pick the models people can choose for tasks. The first one is the default. Turn reasoning off for models that don't support it.
      </p>
      {props.selected.map((model, index) => (
        <div key={model.modelId} className="admin-setup-model-row">
          <strong>{model.modelId}</strong>
          <select value={model.reasoningEffort} onChange={(event) => update(model.modelId, { reasoningEffort: event.target.value as ReasoningEffortChoice })} aria-label={`Reasoning for ${model.modelId}`}>
            {REASONING_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
          {index === 0
            ? <span className="muted-text">Default</span>
            : <button type="button" className="link-button" onClick={() => makeDefault(model.modelId)}>Make default</button>}
          <button type="button" className="link-button" onClick={() => remove(model.modelId)}>Remove</button>
        </div>
      ))}
      {props.availableModels.length > 0 ? (
        <>
          <input type="search" value={filter} onChange={(event) => setFilter(event.target.value)} placeholder={`Search ${props.availableModels.length} models`} />
          <div className="admin-setup-model-list">
            {visibleModels.map((id) => (
              <button key={id} type="button" className="btn ghost" onClick={() => add(id)}>+ {id}</button>
            ))}
          </div>
        </>
      ) : null}
      <form className="row-actions" onSubmit={(event) => { event.preventDefault(); add(customModel); setCustomModel(""); }}>
        <input value={customModel} onChange={(event) => setCustomModel(event.target.value)} placeholder="Add a model ID manually" />
        <button type="submit" className="btn ghost" disabled={!customModel.trim()}>Add</button>
      </form>
      <div className="row-actions">
        <button type="button" className="btn primary" disabled={props.selected.length === 0} onClick={props.onNext}>Continue</button>
      </div>
    </div>
  );
}

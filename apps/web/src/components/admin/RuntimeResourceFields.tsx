import type { RuntimeResourceDraft } from "./runtime-resource-draft";

interface RuntimeResourceFieldConfig {
  placeholder?: string;
  hint?: string;
}

interface RuntimeResourceFieldsProps {
  draft: RuntimeResourceDraft;
  onChange: (draft: RuntimeResourceDraft) => void;
  fieldConfig?: Partial<Record<keyof RuntimeResourceDraft, RuntimeResourceFieldConfig>>;
  className?: string;
}

interface RuntimeResourceFieldDefinition {
  key: keyof RuntimeResourceDraft;
  label: string;
  min: number;
  step: number;
}

const FIELD_DEFINITIONS: RuntimeResourceFieldDefinition[] = [
  { key: "workspaceLimit", label: "Workspace limit", min: 1, step: 1 },
  { key: "workspaceStorageMb", label: "Workspace storage (MB)", min: 1, step: 1 },
  { key: "sandboxMemoryMb", label: "Memory (MB)", min: 1, step: 1 },
  { key: "sandboxCpus", label: "CPUs", min: 0.1, step: 0.1 },
  { key: "sandboxPidsLimit", label: "PIDs", min: 1, step: 1 },
  { key: "persistentRuntimeComputeCredits", label: "Runtime credits / month", min: 0, step: 1 },
  { key: "persistentRuntimeLimit", label: "Persistent runtimes", min: 0, step: 1 }
];

export function RuntimeResourceFields(props: RuntimeResourceFieldsProps) {
  const className = props.className ?? "admin-user-resources-grid";

  function updateField(key: keyof RuntimeResourceDraft, value: string) {
    props.onChange({
      ...props.draft,
      [key]: value
    });
  }

  return (
    <div className={className}>
      {FIELD_DEFINITIONS.map((field) => {
        const config = props.fieldConfig?.[field.key];

        return (
          <label key={field.key} className="stack-form">
            <span>{field.label}</span>
            <input
              type="number"
              min={field.min}
              step={field.step}
              value={props.draft[field.key]}
              placeholder={config?.placeholder}
              onChange={(event) => updateField(field.key, event.target.value)}
            />
            {config?.hint ? <small className="muted-text">{config.hint}</small> : null}
          </label>
        );
      })}
    </div>
  );
}

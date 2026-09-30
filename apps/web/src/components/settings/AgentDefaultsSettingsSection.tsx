export interface AgentPersonalityOption {
  id: string;
  label: string;
}

interface AgentDefaultsSettingsSectionProps {
  mode: "workspace" | "environment" | "project";
  disabled?: boolean;
  systemPrompt: string;
  personalityId: string | null;
  sandboxNetworkEnabled: boolean | null;
  personalityOptions: AgentPersonalityOption[];
  defaultPersonalityId: string | null;
  workspaceDefaultPersonalityLabel?: string | null;
  workspaceDefaultNetworkEnabled?: boolean;
  onSystemPromptChange: (value: string) => void;
  onPersonalityChange: (value: string | null) => void;
  onSandboxNetworkChange: (value: boolean | null) => void;
}

function toSelectValue(value: string | null): string {
  return value ?? "__default__";
}

function toSandboxSelectValue(value: boolean | null): string {
  if (value === true) {
    return "true";
  }
  if (value === false) {
    return "false";
  }
  return "__default__";
}

function resolveDefaultPersonalityLabel(props: AgentDefaultsSettingsSectionProps): string {
  if ((props.mode === "environment" || props.mode === "project") && props.workspaceDefaultPersonalityLabel) {
    return `Workspace default (${props.workspaceDefaultPersonalityLabel})`;
  }

  const platformDefault = props.personalityOptions.find((option) => option.id === props.defaultPersonalityId);
  if ((props.mode === "environment" || props.mode === "project") && platformDefault) {
    return `Workspace default (Platform default: ${platformDefault.label})`;
  }

  if (platformDefault) {
    return `Platform default (${platformDefault.label})`;
  }

  return props.mode === "workspace" ? "Platform default" : "Workspace default";
}

function resolveDefaultNetworkLabel(props: AgentDefaultsSettingsSectionProps): string {
  if (props.mode !== "workspace") {
    return `Workspace default (${props.workspaceDefaultNetworkEnabled === false ? "Blocked" : "Allowed"})`;
  }

  return "Platform default (Allowed)";
}

function resolveSystemPromptLabel(mode: "workspace" | "environment" | "project"): string {
  return mode === "workspace" ? "System Prompt" : "System Prompt Override";
}

function resolveSystemPromptHint(mode: "workspace" | "environment" | "project"): string {
  if (mode === "workspace") {
    return "Appended to the system instructions for every task in this workspace. Leave blank to use the default behavior.";
  }

  return "Appended after the workspace system prompt. Leave blank to use the workspace prompt only.";
}

function resolvePersonalityHint(mode: "workspace" | "environment" | "project"): string {
  if (mode === "workspace") {
    return "Sets the default speaking style for tasks in this workspace.";
  }

  return "Overrides the workspace default personality for this project.";
}

function resolveSandboxHint(mode: "workspace" | "environment" | "project"): string {
  if (mode === "workspace") {
    return "Sets the default outbound network access policy for task runs and shell sessions in this workspace.";
  }

  return "Overrides the workspace network policy for task runs and shell sessions in this project.";
}

export function AgentDefaultsSettingsSection(props: AgentDefaultsSettingsSectionProps) {
  return (
    <div className="stack-form">
      <label>
        <strong>{resolveSystemPromptLabel(props.mode)}</strong>
        <p className="hint-text">{resolveSystemPromptHint(props.mode)}</p>
        <textarea
          value={props.systemPrompt}
          onChange={(event) => props.onSystemPromptChange(event.target.value)}
          rows={6}
          disabled={props.disabled}
        />
      </label>

      <label>
        <strong>Personality</strong>
        <p className="hint-text">{resolvePersonalityHint(props.mode)}</p>
        <select
          value={toSelectValue(props.personalityId)}
          onChange={(event) => props.onPersonalityChange(event.target.value === "__default__" ? null : event.target.value)}
          disabled={props.disabled || props.personalityOptions.length === 0}
        >
          <option value="__default__">{resolveDefaultPersonalityLabel(props)}</option>
          {props.personalityOptions.map((option) => (
            <option key={option.id} value={option.id}>{option.label}</option>
          ))}
        </select>
      </label>

      <label>
        <strong>Allow Sandbox Network Access</strong>
        <p className="hint-text">{resolveSandboxHint(props.mode)}</p>
        <select
          value={toSandboxSelectValue(props.sandboxNetworkEnabled)}
          onChange={(event) => {
            if (event.target.value === "__default__") {
              props.onSandboxNetworkChange(null);
              return;
            }

            props.onSandboxNetworkChange(event.target.value === "true");
          }}
          disabled={props.disabled}
        >
          <option value="__default__">{resolveDefaultNetworkLabel(props)}</option>
          <option value="true">Allow</option>
          <option value="false">Block</option>
        </select>
      </label>
    </div>
  );
}

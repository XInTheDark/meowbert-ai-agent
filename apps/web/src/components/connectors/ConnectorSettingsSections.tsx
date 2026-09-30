export interface PairCodeState {
  code: string;
  expiresAt: string;
  instructions: string;
}

interface PairingState {
  paired: boolean;
  pairedAt: string | null;
}

interface PairingCardProps {
  connectorLabel: string;
  pairing: PairingState | undefined;
  pairCode: PairCodeState | null;
  isSaving: boolean;
  isConnectorActive: boolean;
  onIssueCode: () => void;
}

interface ProjectOption {
  id: string;
  name: string;
}

interface DefaultProjectFieldProps {
  value: string;
  environments?: ProjectOption[];
  projects?: ProjectOption[];
  onChange: (value: string) => void;
  hint: string;
  disabled?: boolean;
}

interface AdvancedFlagsCardProps {
  prefixEnabled: boolean;
  keywordEnabled: boolean;
  llmFallbackEnabled: boolean;
  onPrefixEnabledChange: (value: boolean) => void;
  onKeywordEnabledChange: (value: boolean) => void;
  onLlmFallbackEnabledChange: (value: boolean) => void;
  disabled?: boolean;
}

function formatPairingTimestamp(value: string | null | undefined): string {
  if (!value) {
    return "";
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return parsed.toLocaleString();
}

export function PairingCard(props: PairingCardProps) {
  const { connectorLabel, pairing, pairCode, isSaving, isConnectorActive, onIssueCode } = props;

  return (
    <div className="section-card" style={{ boxShadow: "none", background: "var(--surface-muted)" }}>
      <div className="section-head" style={{ marginBottom: "0.6rem" }}>
        <div>
          <strong>Pair this {connectorLabel} account</strong>
          <p className="hint-text" style={{ margin: "0.25rem 0 0" }}>
            {pairing?.paired
              ? `Paired since ${formatPairingTimestamp(pairing.pairedAt)}.`
              : `No ${connectorLabel} account paired for your user yet.`}
          </p>
        </div>
        <button className="btn ghost" type="button" disabled={isSaving || !isConnectorActive} onClick={onIssueCode}>
          {pairCode ? "Regenerate Code" : "Pair"}
        </button>
      </div>

      {pairCode ? (
        <div style={{ display: "grid", gap: "0.45rem" }}>
          <p style={{ margin: 0 }}>
            <strong>One-time code</strong>
          </p>
          <p style={{ margin: 0 }}>
            <code>{pairCode.code}</code>
          </p>
          <p className="hint-text" style={{ margin: 0 }}>
            {pairCode.instructions}
          </p>
          <p className="hint-text" style={{ margin: 0 }}>
            Expires at {formatPairingTimestamp(pairCode.expiresAt)}.
          </p>
        </div>
      ) : null}
    </div>
  );
}

export function DefaultProjectField(props: DefaultProjectFieldProps) {
  const { value, onChange, hint, disabled = false } = props;
  const projects = props.projects ?? props.environments ?? [];

  return (
    <label>
      <strong>Default project</strong>
      <select value={value} onChange={(event) => onChange(event.target.value)} disabled={disabled || projects.length === 0}>
        {projects.length === 0 ? <option value="">No active projects</option> : null}
        {projects.map((project) => (
          <option key={project.id} value={project.id}>
            {project.name}
          </option>
        ))}
      </select>
      <span className="hint-text">{hint}</span>
    </label>
  );
}

export const DefaultEnvironmentField = DefaultProjectField;

export function AdvancedFlagsCard(props: AdvancedFlagsCardProps) {
  const {
    prefixEnabled,
    keywordEnabled,
    llmFallbackEnabled,
    onPrefixEnabledChange,
    onKeywordEnabledChange,
    onLlmFallbackEnabledChange,
    disabled = false
  } = props;

  return (
    <div className="section-card" style={{ gap: "0.4rem", boxShadow: "none", background: "var(--surface-muted)" }}>
      <strong>Advanced routing flags</strong>
      <p className="hint-text" style={{ margin: 0 }}>
        These flags are saved in connector config for compatibility.
      </p>
      <label style={{ display: "flex", alignItems: "center", gap: "0.55rem" }}>
        <input
          type="checkbox"
          checked={prefixEnabled}
          onChange={(event) => onPrefixEnabledChange(event.target.checked)}
          disabled={disabled}
          style={{ width: "1rem", height: "1rem" }}
        />
        <span>prefixEnabled</span>
      </label>
      <label style={{ display: "flex", alignItems: "center", gap: "0.55rem" }}>
        <input
          type="checkbox"
          checked={keywordEnabled}
          onChange={(event) => onKeywordEnabledChange(event.target.checked)}
          disabled={disabled}
          style={{ width: "1rem", height: "1rem" }}
        />
        <span>keywordEnabled</span>
      </label>
      <label style={{ display: "flex", alignItems: "center", gap: "0.55rem" }}>
        <input
          type="checkbox"
          checked={llmFallbackEnabled}
          onChange={(event) => onLlmFallbackEnabledChange(event.target.checked)}
          disabled={disabled}
          style={{ width: "1rem", height: "1rem" }}
        />
        <span>llmFallbackEnabled</span>
      </label>
    </div>
  );
}

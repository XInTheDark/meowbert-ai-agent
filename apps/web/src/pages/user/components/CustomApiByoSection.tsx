import { FormEvent } from "react";

interface CustomApiByoSectionProps {
  baseUrl: string;
  model: string;
  apiKey: string;
  hasApiKey: boolean;
  isCurrentProvider: boolean;
  fetchedModels: string[];
  saving: boolean;
  fetchingModels: boolean;
  onBaseUrlChange: (value: string) => void;
  onModelChange: (value: string) => void;
  onApiKeyChange: (value: string) => void;
  onFetchModels: () => Promise<void>;
  onSave: (event: FormEvent) => Promise<void>;
}

export function CustomApiByoSection(props: CustomApiByoSectionProps) {
  return (
    <form className="stack-form" onSubmit={props.onSave}>
      <label>
        Base URL
        <input
          type="url"
          value={props.baseUrl}
          onChange={(event) => props.onBaseUrlChange(event.target.value)}
          placeholder="https://api.openai.com/v1"
        />
      </label>

      <label>
        Model
        <input
          type="text"
          value={props.model}
          onChange={(event) => props.onModelChange(event.target.value)}
          placeholder="gpt-4o"
        />
      </label>

      <label>
        API key {props.hasApiKey ? <span className="field-hint">(leave blank to keep existing)</span> : null}
        <input
          type="password"
          value={props.apiKey}
          onChange={(event) => props.onApiKeyChange(event.target.value)}
          placeholder="sk-..."
          autoComplete="off"
        />
      </label>

      <div className="row-actions">
        <button className="btn ghost" type="button" onClick={() => void props.onFetchModels()} disabled={props.fetchingModels || props.saving}>
          {props.fetchingModels ? "Fetching models..." : "Fetch Models"}
        </button>
        <button className="btn primary" type="submit" disabled={props.saving}>
          {props.saving ? "Saving..." : props.isCurrentProvider ? "Save API Key Settings" : "Use Custom API Key"}
        </button>
      </div>

      {props.fetchedModels.length > 0 ? (
        <label>
          Select fetched model
          <select value={props.model} onChange={(event) => props.onModelChange(event.target.value)}>
            {props.fetchedModels.map((model) => (
              <option key={model} value={model}>{model}</option>
            ))}
          </select>
        </label>
      ) : null}
    </form>
  );
}

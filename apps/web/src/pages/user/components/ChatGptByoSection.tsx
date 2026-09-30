import { useEffect, useState } from "react";
import { CheckCircle2, LogOut, Sparkles } from "lucide-react";

interface ChatGptByoSectionProps {
  chatgpt?: {
    isConnected: boolean;
    email: string | null;
    accountId: string | null;
    forcedModel: string | null;
    expiresAt: string | null;
  } | null;
  isCurrentProvider: boolean;
  onOpenAuthModal: () => void;
  onDisconnect: () => Promise<void>;
  onEnable: () => Promise<void>;
  onForceDefaultModelChange: (model: string) => Promise<void>;
  disabled: boolean;
}

export function ChatGptByoSection(props: ChatGptByoSectionProps) {
  const [forcedModel, setForcedModel] = useState(props.chatgpt?.forcedModel ?? "");
  const [updatingModel, setUpdatingModel] = useState(false);
  const isConnected = props.chatgpt?.isConnected === true;

  useEffect(() => {
    setForcedModel(props.chatgpt?.forcedModel ?? "");
  }, [props.chatgpt?.forcedModel]);

  async function handleForceDefaultModelSave() {
    if (updatingModel) return;
    setUpdatingModel(true);
    try {
      await props.onForceDefaultModelChange(forcedModel);
    } finally {
      setUpdatingModel(false);
    }
  }

  if (!isConnected) {
    return (
      <div className="section-card" style={{ boxShadow: "none", background: "var(--surface-muted)", display: "grid", gap: "0.75rem", padding: "1rem" }}>
        <div>
          <strong>Sign in with ChatGPT</strong>
          <p className="muted-text" style={{ margin: "0.25rem 0 0", fontSize: "0.9rem" }}>
            Connect your personal ChatGPT Plus, Pro, or Team subscription using OpenAI OAuth to power tasks without an API key.
          </p>
        </div>
        <div>
          <button className="btn primary" type="button" onClick={props.onOpenAuthModal} disabled={props.disabled}>
            <Sparkles size={16} />
            <span>Sign in with ChatGPT</span>
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="section-card" style={{ boxShadow: "none", background: "var(--surface-muted)", display: "grid", gap: "0.75rem", padding: "1rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "0.5rem" }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
            <CheckCircle2 size={16} color="var(--accent, #10a37f)" />
            <strong>ChatGPT Connected</strong>
          </div>
          <p className="muted-text" style={{ margin: "0.2rem 0 0", fontSize: "0.85rem" }}>
            Account: {props.chatgpt?.email || props.chatgpt?.accountId || "Authorized"}
          </p>
        </div>
        <button className="btn ghost danger" type="button" onClick={() => void props.onDisconnect()} disabled={props.disabled} title="Disconnect account">
          <LogOut size={14} />
          <span>Disconnect</span>
        </button>
      </div>

      <div style={{ display: "grid", gap: "0.5rem" }}>
        <label style={{ fontSize: "0.9rem", display: "grid", gap: "0.3rem" }}>
          Force default model
          <input
            type="text"
            value={forcedModel}
            onChange={(event) => setForcedModel(event.target.value)}
            placeholder="Leave blank to use the task model"
            disabled={props.disabled || updatingModel}
          />
        </label>
        <p className="muted-text" style={{ margin: 0, fontSize: "0.8rem" }}>
          Leave blank to use the model selected for each task.
        </p>
        <div>
          <button className="btn ghost" type="button" onClick={() => void handleForceDefaultModelSave()} disabled={props.disabled || updatingModel}>
            {updatingModel ? "Saving..." : "Save"}
          </button>
        </div>
      </div>

      {!props.isCurrentProvider ? (
        <div>
          <button className="btn primary" type="button" onClick={() => void props.onEnable()} disabled={props.disabled}>
            Use ChatGPT as Active BYO Provider
          </button>
        </div>
      ) : null}
    </div>
  );
}

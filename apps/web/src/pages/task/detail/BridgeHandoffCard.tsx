import { useEffect, useState } from "react";
import { Check, Copy, Plug, Unplug } from "lucide-react";
import type { BridgeHandoffInfo, BridgeServerStatus } from "@meowbert/shared";
import { platform } from "../../../desktop/platform";
import { buildBridgeMcpConfigJson } from "../../desktop/bridgeConfigSnippet";

function BridgeSetupSnippet(props: {
  serverStatus: BridgeServerStatus | null;
  copiedConfig: boolean;
  onCopyConfig: () => void;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span className="muted-text" style={{ fontSize: "0.78rem" }}>One-time MCP server config (install once in your harness):</span>
        <button type="button" className="btn ghost" style={{ padding: "0.2rem 0.5rem", fontSize: "0.76rem" }} onClick={props.onCopyConfig}>
          {props.copiedConfig ? <Check size={13} /> : <Copy size={13} />}
          {props.copiedConfig ? "Copied JSON" : "Copy JSON"}
        </button>
      </div>
      {props.serverStatus ? (
        <pre style={{ margin: 0, padding: "0.45rem 0.6rem", borderRadius: "6px", background: "var(--surface)", fontSize: "0.74rem", overflowX: "auto" }}>
          {buildBridgeMcpConfigJson(props.serverStatus)}
        </pre>
      ) : (
        <span className="muted-text" style={{ fontSize: "0.78rem" }}>Loading bridge config…</span>
      )}
    </div>
  );
}

export function BridgeHandoffCard(props: { taskId: string }) {
  const [handoff, setHandoff] = useState<BridgeHandoffInfo | null>(null);
  const [serverStatus, setServerStatus] = useState<BridgeServerStatus | null>(null);
  const [showSetup, setShowSetup] = useState(false);
  const [copiedPrompt, setCopiedPrompt] = useState(false);
  const [copiedConfig, setCopiedConfig] = useState(false);
  const [parking, setParking] = useState(false);

  useEffect(() => {
    if (!platform.capabilities.isDesktop) return;
    let cancelled = false;
    void platform.getTaskBridgeHandoff(props.taskId).then((next) => {
      if (!cancelled) setHandoff(next);
    });
    const unsubscribe = platform.onBridgeSessionsChanged((sessions) => {
      const match = sessions.find((entry) => entry.taskId === props.taskId) ?? null;
      setHandoff(match);
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [props.taskId]);

  useEffect(() => {
    if (!showSetup || serverStatus) return;
    let cancelled = false;
    void platform.getBridgeStatus().then((next) => {
      if (!cancelled) setServerStatus(next);
    });
    return () => { cancelled = true; };
  }, [showSetup, serverStatus]);

  if (!handoff || (handoff.status !== "waiting_for_start" && handoff.status !== "connected")) {
    return null;
  }

  const isWaiting = handoff.status === "waiting_for_start";
  const modeLabel = handoff.mode === "host" ? "Host" : "Sandbox";

  async function handleCopyPrompt() {
    if (!handoff) return;
    await navigator.clipboard.writeText(handoff.prompt);
    setCopiedPrompt(true);
    setTimeout(() => setCopiedPrompt(false), 1800);
  }

  async function handleCopyConfig() {
    const status = serverStatus ?? await platform.getBridgeStatus();
    setServerStatus(status);
    await navigator.clipboard.writeText(buildBridgeMcpConfigJson(status));
    setCopiedConfig(true);
    setTimeout(() => setCopiedConfig(false), 1800);
  }

  async function handleDisconnect() {
    if (!handoff) return;
    setParking(true);
    try {
      await platform.parkBridgeRun(handoff.runId);
    } finally {
      setParking(false);
    }
  }

  return (
    <div
      role="status"
      className="bridge-handoff-card"
      style={{
        margin: "0 1rem 0.65rem",
        padding: "0.65rem 0.85rem",
        borderRadius: "10px",
        border: "1px solid var(--border)",
        background: "var(--surface-elevated, var(--surface))",
        display: "flex",
        flexDirection: "column",
        gap: "0.5rem",
        fontSize: "0.85rem"
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.5rem", flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.45rem" }}>
          <Plug size={15} />
          <strong>{isWaiting ? "Waiting for external harness" : "Connected via Bridge"}</strong>
          <span className="muted-text">
            {modeLabel} · <code>{handoff.sessionCode}</code>
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "0.35rem" }}>
          <button type="button" className={`btn ${isWaiting ? "primary" : "ghost"}`} style={{ padding: "0.25rem 0.6rem", fontSize: "0.8rem" }} onClick={() => void handleCopyPrompt()}>
            {copiedPrompt ? <Check size={14} /> : <Copy size={14} />}
            {copiedPrompt ? "Copied" : "Copy prompt"}
          </button>
          {isWaiting ? (
            <button type="button" className="btn ghost" style={{ padding: "0.25rem 0.55rem", fontSize: "0.8rem" }} onClick={() => setShowSetup((v) => !v)}>
              {showSetup ? "Hide MCP setup" : "MCP setup"}
            </button>
          ) : null}
          <button
            type="button"
            className="btn ghost"
            style={{ padding: "0.25rem 0.55rem", fontSize: "0.8rem" }}
            disabled={parking}
            title="Disconnect bridge and park task as awaiting input"
            onClick={() => void handleDisconnect()}
          >
            <Unplug size={14} />
            {parking ? "Parking…" : "Disconnect"}
          </button>
        </div>
      </div>
      {isWaiting ? (
        <pre style={{ margin: 0, padding: "0.45rem 0.6rem", borderRadius: "6px", background: "var(--surface)", fontSize: "0.78rem", whiteSpace: "pre-wrap", overflowX: "auto" }}>
          {handoff.prompt}
        </pre>
      ) : null}
      {isWaiting && showSetup ? (
        <BridgeSetupSnippet serverStatus={serverStatus} copiedConfig={copiedConfig} onCopyConfig={() => void handleCopyConfig()} />
      ) : null}
    </div>
  );
}

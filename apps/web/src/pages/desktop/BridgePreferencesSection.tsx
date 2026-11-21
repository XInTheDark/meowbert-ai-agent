import { useEffect, useState } from "react";
import { Check, Copy, RefreshCw } from "lucide-react";
import type { BridgeServerStatus, BridgeToolMode } from "@meowbert/shared";
import { platform } from "../../desktop/platform";
import { DesktopPreferenceRow, DesktopPreferenceSection } from "./DesktopPreferenceFields";
import { buildBridgeMcpConfigJson } from "./bridgeConfigSnippet";

export function BridgePreferencesSection() {
  const [status, setStatus] = useState<BridgeServerStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void platform.getBridgeStatus().then((next) => {
      if (!cancelled) setStatus(next);
    });
    return () => { cancelled = true; };
  }, []);

  if (!status) return null;

  const configJson = buildBridgeMcpConfigJson(status);

  async function handleCopyConfig() {
    await navigator.clipboard.writeText(configJson);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }

  async function handleToolModeChange(toolMode: BridgeToolMode) {
    setBusy(true);
    try {
      setStatus(await platform.setBridgeToolMode(toolMode));
    } finally {
      setBusy(false);
    }
  }

  async function handleRotateToken() {
    setBusy(true);
    try {
      setStatus(await platform.regenerateBridgeToken());
    } finally {
      setBusy(false);
    }
  }

  return (
    <DesktopPreferenceSection title="External harness bridge (MCP)">
      <DesktopPreferenceRow
        title="Local MCP server"
        description={status.running && status.endpointUrl
          ? <>Listening on <code>{status.endpointUrl}</code>. Add once to Antigravity or any MCP harness.</>
          : status.error ?? "Starts automatically when bridge mode is used."}
      >
        <div style={{ display: "flex", gap: "0.4rem", alignItems: "center" }}>
          <button type="button" className="btn ghost" disabled={busy || !status.bearerToken} onClick={() => void handleCopyConfig()}>
            {copied ? <Check size={14} /> : <Copy size={14} />}
            {copied ? "Copied" : "Copy MCP JSON"}
          </button>
          <button
            type="button"
            className="icon-btn"
            disabled={busy}
            title="Rotate bearer token"
            aria-label="Rotate bridge bearer token"
            onClick={() => void handleRotateToken()}
          >
            <RefreshCw size={14} />
          </button>
        </div>
      </DesktopPreferenceRow>
      <DesktopPreferenceRow
        title="MCP tool surface"
        description="Compact exposes 3 meta-tools for MCP clients with strict tool count limits."
        controlId="bridge-tool-mode"
      >
        <select
          id="bridge-tool-mode"
          value={status.toolMode}
          disabled={busy}
          onChange={(event) => void handleToolModeChange(event.target.value as BridgeToolMode)}
        >
          <option value="standard">Standard</option>
          <option value="compact">Compact (3 tools)</option>
        </select>
      </DesktopPreferenceRow>
    </DesktopPreferenceSection>
  );
}

import { useState } from "react";
import { Link2, RefreshCw, Unplug } from "lucide-react";
import {
  canUseWorkspaceSourceLiveSync,
  getWorkspaceSourceSetupLabel,
  isWorkspaceSourceReady,
  type WorkspaceSourceSummary
} from "../../../sources/sourceTypes";

interface SourcesConnectorTabProps {
  sources: WorkspaceSourceSummary[];
  canManage: boolean;
  isLoading: boolean;
  isSaving: boolean;
  error: string | null;
  onConnect: (source: WorkspaceSourceSummary) => Promise<void>;
  onDisconnect: (source: WorkspaceSourceSummary) => Promise<void>;
  onConfigureRclone: (
    source: WorkspaceSourceSummary,
    config: { rcloneConfig: string; remoteName: string; baseDirectory: string }
  ) => Promise<void>;
  onRefresh: () => Promise<void>;
}

interface RcloneConfigDraft {
  rcloneConfig: string;
  remoteName: string;
  baseDirectory: string;
}

function buildEmptyRcloneConfigDraft(): RcloneConfigDraft {
  return {
    rcloneConfig: "",
    remoteName: "",
    baseDirectory: ""
  };
}

export function SourcesConnectorTab(props: SourcesConnectorTabProps) {
  const [rcloneDrafts, setRcloneDrafts] = useState<Record<string, RcloneConfigDraft>>({});

  function getRcloneDraft(sourceId: string): RcloneConfigDraft {
    return rcloneDrafts[sourceId] ?? buildEmptyRcloneConfigDraft();
  }

  function updateRcloneDraft(sourceId: string, updater: (draft: RcloneConfigDraft) => RcloneConfigDraft): void {
    setRcloneDrafts((current) => ({
      ...current,
      [sourceId]: updater(current[sourceId] ?? buildEmptyRcloneConfigDraft())
    }));
  }

  if (props.isLoading) {
    return <p className="muted-text" style={{ marginTop: "1rem" }}>Loading sources…</p>;
  }

  return (
    <div className="stack-form" style={{ marginTop: "1rem" }}>
      {props.sources.map((source) => {
        const isReady = isWorkspaceSourceReady(source);
        const liveSyncReady = canUseWorkspaceSourceLiveSync(source);
        const canConnect = props.canManage
          && source.requiresWorkspaceConnection
          && source.admin.configured
          && source.admin.enabled;
        const isRclone = source.provider === "rclone";
        const rcloneDraft = isRclone ? getRcloneDraft(source.id) : null;

        return (
          <section
            key={source.id}
            className="section-card"
            style={{ boxShadow: "none", background: "var(--surface-muted)" }}
          >
            <div className="section-head" style={{ marginBottom: "0.85rem" }}>
              <div>
                <strong>{source.name}</strong>
                <p className="hint-text" style={{ margin: "0.25rem 0 0" }}>
                  {source.description}
                </p>
              </div>
            </div>

            <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginBottom: "0.75rem" }}>
              <span className={`badge ${source.admin.configured ? "success" : "muted"}`}>
                {source.admin.configured
                  ? (source.requiresAdminCredentials ? "Admin configured" : "Admin enabled")
                  : (source.requiresAdminCredentials ? "Needs admin setup" : "Needs admin enable")}
              </span>
              <span className={`badge ${source.admin.enabled ? "success" : "muted"}`}>
                {source.admin.enabled ? "Enabled" : "Disabled"}
              </span>
              <span className={`badge ${isReady ? "success" : "muted"}`}>
                {source.requiresWorkspaceConnection
                  ? (source.connection.connected ? "Connected" : "Not connected")
                  : "No auth required"}
              </span>
              {source.supportsLiveSync ? (
                <span className={`badge ${liveSyncReady ? "success" : "muted"}`}>
                  {!source.connection.connected
                    ? "Live sync after connect"
                    : source.connection.canWrite
                      ? "Live sync ready"
                      : "Live sync needs write access"}
                </span>
              ) : null}
            </div>

            <div className="stack-form" style={{ gap: "0.45rem", marginBottom: "0.9rem" }}>
              <div className="muted-text">
                <strong style={{ color: "var(--text-primary)" }}>Status:</strong> {getWorkspaceSourceSetupLabel(source)}
              </div>
              {source.requiresWorkspaceConnection && source.connection.accountLabel ? (
                <div className="muted-text">
                  <strong style={{ color: "var(--text-primary)" }}>Account:</strong> {source.connection.accountLabel}
                </div>
              ) : null}
              {source.requiresWorkspaceConnection && source.connection.connectedAt ? (
                <div className="muted-text">
                  <strong style={{ color: "var(--text-primary)" }}>Connected:</strong> {new Date(source.connection.connectedAt).toLocaleString()}
                </div>
              ) : null}
              {source.supportsLiveSync && source.requiresWorkspaceConnection ? (
                <div className="muted-text">
                  <strong style={{ color: "var(--text-primary)" }}>Write access:</strong> {!source.connection.connected ? "Not connected" : source.connection.canWrite ? "Enabled" : "Reconnect required"}
                </div>
              ) : null}
              {!source.requiresWorkspaceConnection ? (
                <div className="muted-text">
                  <strong style={{ color: "var(--text-primary)" }}>Setup:</strong> No workspace connection required.
                </div>
              ) : null}
            </div>

            {isRclone && rcloneDraft ? (
              <form
                className="stack-form"
                style={{ gap: "0.65rem", marginBottom: "0.9rem" }}
                onSubmit={(event) => {
                  event.preventDefault();
                  void props.onConfigureRclone(source, rcloneDraft);
                }}
              >
                <label>
                  <strong>rclone.conf</strong>
                  <textarea
                    value={rcloneDraft.rcloneConfig}
                    onChange={(event) => updateRcloneDraft(source.id, (current) => ({
                      ...current,
                      rcloneConfig: event.target.value
                    }))}
                    placeholder={"[remote-name]\ntype = ..."}
                    rows={8}
                    spellCheck={false}
                    style={{
                      width: "100%",
                      minHeight: "9rem",
                      resize: "vertical",
                      fontFamily: "var(--font-mono, monospace)"
                    }}
                    disabled={!canConnect || props.isSaving}
                  />
                </label>
                <div style={{ display: "grid", gap: "0.65rem", gridTemplateColumns: "repeat(auto-fit, minmax(12rem, 1fr))" }}>
                  <label>
                    <strong>Remote name</strong>
                    <input
                      type="text"
                      value={rcloneDraft.remoteName}
                      onChange={(event) => updateRcloneDraft(source.id, (current) => ({
                        ...current,
                        remoteName: event.target.value
                      }))}
                      placeholder="remote-name"
                      autoComplete="off"
                      disabled={!canConnect || props.isSaving}
                    />
                  </label>
                  <label>
                    <strong>Base directory</strong>
                    <input
                      type="text"
                      value={rcloneDraft.baseDirectory}
                      onChange={(event) => updateRcloneDraft(source.id, (current) => ({
                        ...current,
                        baseDirectory: event.target.value
                      }))}
                      placeholder="optional/path"
                      autoComplete="off"
                      disabled={!canConnect || props.isSaving}
                    />
                  </label>
                </div>
                <div className="row-actions">
                  <button
                    type="submit"
                    className="btn primary"
                    disabled={!canConnect || props.isSaving || !rcloneDraft.rcloneConfig.trim() || !rcloneDraft.remoteName.trim()}
                  >
                    <Link2 size={16} />
                    {source.connection.connected ? "Save config" : "Connect"}
                  </button>
                </div>
              </form>
            ) : null}

            <div className="row-actions">
              {source.requiresWorkspaceConnection && !isRclone ? (
                <>
                  <button
                    type="button"
                    className="btn primary"
                    disabled={!canConnect || props.isSaving}
                    onClick={() => {
                      void props.onConnect(source);
                    }}
                  >
                    <Link2 size={16} />
                    {source.connection.connected ? "Reconnect" : "Connect"}
                  </button>
                </>
              ) : null}
              {source.requiresWorkspaceConnection ? (
                <>
                  <button
                    type="button"
                    className="btn ghost"
                    disabled={!source.connection.connected || !props.canManage || props.isSaving}
                    onClick={() => {
                      void props.onDisconnect(source);
                    }}
                  >
                    <Unplug size={16} />
                    Disconnect
                  </button>
                </>
              ) : null}
              <button
                type="button"
                className="btn ghost"
                disabled={props.isSaving}
                onClick={() => {
                  void props.onRefresh();
                }}
              >
                <RefreshCw size={16} />
                Refresh
              </button>
            </div>

            {!props.canManage ? (
              <p className="muted-text" style={{ marginTop: "0.7rem", marginBottom: 0 }}>
                Workspace owners manage source connections.
              </p>
            ) : null}
            {props.canManage && !source.admin.configured ? (
              <p className="muted-text" style={{ marginTop: "0.7rem", marginBottom: 0 }}>
                {source.requiresAdminCredentials
                  ? "Add the OAuth app credentials in Admin → Sources first."
                  : "Enable this source in Admin → Sources first."}
              </p>
            ) : null}
            {props.canManage && source.requiresWorkspaceConnection && source.admin.configured && source.admin.enabled && !isReady ? (
              <p className="muted-text" style={{ marginTop: "0.7rem", marginBottom: 0 }}>
                Connect a workspace account to use this source in chats and attachments.
              </p>
            ) : null}
            {props.canManage && source.supportsLiveSync && source.connection.connected && !source.connection.canWrite ? (
              <p className="muted-text" style={{ marginTop: "0.7rem", marginBottom: 0 }}>
                Reconnect this workspace account to grant write access and enable live sync attachments.
              </p>
            ) : null}
          </section>
        );
      })}

      {props.sources.length === 0 ? (
        <p className="muted-text">No sources are installed on this server yet.</p>
      ) : null}
      {props.error ? <p className="error-text">{props.error}</p> : null}
    </div>
  );
}

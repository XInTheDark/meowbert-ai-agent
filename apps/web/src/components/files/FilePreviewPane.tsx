import { ArrowDownToLine, ArrowUpToLine, Download, ExternalLink, Link2Off, Loader2, X } from "lucide-react";
import type {
  EnvironmentFileEntry,
  EnvironmentFileLiveSyncStatus,
  EnvironmentFilePreview
} from "../../lib/types";
import { FilePreviewBody } from "./FilePreviewBody";

interface FilePreviewPaneProps {
  selectedEntry: EnvironmentFileEntry | null;
  filePreview: EnvironmentFilePreview | null;
  selectedCount: number;
  isLoadingPreview?: boolean;
  previewDownloadUrl?: string | null;
  previewToken?: string | null;
  liveSyncStatus: EnvironmentFileLiveSyncStatus | null;
  isLiveSyncStatusLoading: boolean;
  isLiveSyncMutating: boolean;
  isDownloading?: boolean;
  onDownload?: (relativePath: string) => void;
  onLiveSyncPull?: (force?: boolean) => void;
  onLiveSyncPush?: (force?: boolean) => void;
  onLiveSyncOpenRemote?: () => void;
  onLiveSyncUnlink?: () => void;
  onClose: () => void;
}

function formatLiveSyncProviderLabel(provider: NonNullable<EnvironmentFileEntry["liveSync"]>["provider"]): string {
  if (provider === "google-drive") {
    return "Google Drive";
  }
  if (provider === "pcloud") {
    return "pCloud";
  }
  if (provider === "rclone") {
    return "rclone";
  }
  return "OneDrive";
}

function formatLiveSyncStatusLabel(status: EnvironmentFileLiveSyncStatus["status"]): string {
  switch (status) {
    case "synced":
      return "Synced";
    case "local_modified":
      return "Local changes";
    case "remote_modified":
      return "Remote changed";
    case "conflict":
      return "Conflict";
    case "missing_local":
      return "Local missing";
    case "missing_remote":
      return "Remote missing";
    case "error":
      return "Error";
    default:
      return status;
  }
}

export function FilePreviewPane(props: FilePreviewPaneProps) {
  if (props.selectedCount !== 1 || !props.selectedEntry) {
    return null;
  }

  const liveSyncSummary = props.selectedEntry.liveSync ?? null;
  const liveSyncStatus = props.liveSyncStatus;
  const remoteUrl = liveSyncStatus?.remote?.webUrl ?? liveSyncSummary?.remoteWebUrl ?? null;
  const providerLabel = liveSyncSummary ? formatLiveSyncProviderLabel(liveSyncSummary.provider) : "source";
  const liveSyncNoun = (liveSyncStatus?.link.linkKind ?? liveSyncSummary?.linkKind) === "folder" ? "folder" : "file";

  return (
    <div className="file-preview-pane">
      <div
        style={{
          padding: "0.5rem",
          borderBottom: "1px solid var(--border)",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          background: "var(--surface-muted)"
        }}
      >
        <span style={{ fontWeight: 600, fontSize: "0.9rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          Preview
        </span>
        <div style={{ display: "flex", gap: "0.5rem" }}>
          {typeof props.onDownload === "function" ? (
            <button
              className="btn ghost icon-btn"
              type="button"
              title={props.isDownloading ? "Preparing download..." : "Download"}
              aria-label={props.isDownloading ? "Preparing download" : "Download"}
              disabled={props.isDownloading}
              style={{ width: "1.8rem", height: "1.8rem" }}
              onClick={() => props.onDownload?.(props.selectedEntry!.relativePath)}
            >
              {props.isDownloading ? <Loader2 className="spin" size={14} /> : <Download size={14} />}
            </button>
          ) : null}
          <button
            className="btn ghost icon-btn"
            onClick={props.onClose}
            title="Close Preview"
            style={{ width: "1.8rem", height: "1.8rem" }}
          >
            <X size={14} />
          </button>
        </div>
      </div>
      <div style={{ flex: 1, overflow: "auto", padding: "1rem" }}>
        {liveSyncSummary ? (
          <section
            className="section-card"
            style={{
              marginBottom: "1rem",
              padding: "0.85rem",
              boxShadow: "none",
              background: "var(--surface-muted)"
            }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.75rem", flexWrap: "wrap" }}>
              <div>
                <div style={{ fontWeight: 600 }}>Live sync</div>
                <div className="muted-text" style={{ fontSize: "0.82rem" }}>
                  {props.isLiveSyncStatusLoading
                    ? "Checking status…"
                    : liveSyncStatus
                      ? formatLiveSyncStatusLabel(liveSyncStatus.status)
                      : `Linked to ${providerLabel}`}
                </div>
              </div>
              {liveSyncStatus ? (
                <span className={`badge ${liveSyncStatus.status === "synced" ? "success" : liveSyncStatus.status === "error" || liveSyncStatus.status === "conflict" ? "danger" : "muted"}`}>
                  {formatLiveSyncStatusLabel(liveSyncStatus.status)}
                </span>
              ) : (
                <span className="badge muted">Live</span>
              )}
            </div>

            <div className="muted-text" style={{ marginTop: "0.6rem", fontSize: "0.82rem" }}>
              Remote {liveSyncNoun}: {liveSyncStatus?.remote?.name ?? liveSyncSummary.remoteName}
            </div>
            {liveSyncStatus?.message ? (
              <div className="muted-text" style={{ marginTop: "0.45rem", fontSize: "0.82rem" }}>
                {liveSyncStatus.message}
              </div>
            ) : null}
            {!liveSyncStatus?.message && liveSyncSummary.lastSyncError ? (
              <div className="muted-text" style={{ marginTop: "0.45rem", fontSize: "0.82rem" }}>
                Last error: {liveSyncSummary.lastSyncError}
              </div>
            ) : null}

            <div className="row-actions" style={{ marginTop: "0.8rem", flexWrap: "wrap" }}>
              <button
                type="button"
                className="btn ghost"
                disabled={props.isLiveSyncMutating || props.isLiveSyncStatusLoading || !liveSyncStatus?.canPull}
                onClick={() => props.onLiveSyncPull?.(false)}
              >
                <ArrowDownToLine size={14} />
                Pull
              </button>
              {liveSyncStatus?.supportsForcePull ? (
                <button
                  type="button"
                  className="btn ghost"
                  disabled={props.isLiveSyncMutating || props.isLiveSyncStatusLoading}
                  onClick={() => props.onLiveSyncPull?.(true)}
                >
                  <ArrowDownToLine size={14} />
                  Force pull
                </button>
              ) : null}
              <button
                type="button"
                className="btn ghost"
                disabled={props.isLiveSyncMutating || props.isLiveSyncStatusLoading || !liveSyncStatus?.canPush}
                onClick={() => props.onLiveSyncPush?.(false)}
              >
                <ArrowUpToLine size={14} />
                Push
              </button>
              {liveSyncStatus?.supportsForcePush ? (
                <button
                  type="button"
                  className="btn ghost"
                  disabled={props.isLiveSyncMutating || props.isLiveSyncStatusLoading}
                  onClick={() => props.onLiveSyncPush?.(true)}
                >
                  <ArrowUpToLine size={14} />
                  Force push
                </button>
              ) : null}
              {remoteUrl ? (
                <button
                  type="button"
                  className="btn ghost"
                  disabled={props.isLiveSyncMutating}
                  onClick={() => props.onLiveSyncOpenRemote?.()}
                >
                  <ExternalLink size={14} />
                  Open in {providerLabel}
                </button>
              ) : null}
              <button
                type="button"
                className="btn ghost"
                disabled={props.isLiveSyncMutating}
                onClick={() => props.onLiveSyncUnlink?.()}
              >
                <Link2Off size={14} />
                Unlink
              </button>
            </div>
          </section>
        ) : null}

        <FilePreviewBody
          entry={props.selectedEntry}
          preview={props.filePreview}
          isLoading={props.isLoadingPreview}
          previewDownloadUrl={props.previewDownloadUrl}
          previewToken={props.previewToken}
        />
      </div>
    </div>
  );
}

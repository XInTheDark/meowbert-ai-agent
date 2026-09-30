import type { EnvironmentFileEntry, EnvironmentFilePreview } from "../../lib/types";
import { formatBytes } from "../../lib/utils";
import { LoadingIndicator } from "../LoadingIndicator";
import { getInlineFilePreviewKind } from "./filePreviewKinds";
import { useAuthenticatedFilePreview } from "./useAuthenticatedFilePreview";

interface FilePreviewBodyProps {
  entry: EnvironmentFileEntry | null;
  preview: EnvironmentFilePreview | null;
  isLoading?: boolean;
  previewDownloadUrl?: string | null;
  previewToken?: string | null;
}

function renderFallbackBody(preview: EnvironmentFilePreview | null, isLoading: boolean) {
  if (isLoading) {
    return <LoadingIndicator center size={28} label="Loading preview…" delayMs={0} />;
  }

  if (!preview) {
    return (
      <div className="empty-hint" style={{ textAlign: "center", marginTop: "2rem" }}>
        <p>Preview unavailable.</p>
      </div>
    );
  }

  if (preview.encoding === "binary") {
    return (
      <div className="empty-hint" style={{ textAlign: "center", marginTop: "2rem" }}>
        <p>Binary file ({formatBytes(preview.sizeBytes)})</p>
      </div>
    );
  }

  return (
    <pre
      style={{
        margin: 0,
        fontSize: "0.8rem",
        whiteSpace: "pre-wrap",
        wordBreak: "break-all",
        background: "transparent",
        border: "none"
      }}
    >
      {preview.text}
    </pre>
  );
}

export function FilePreviewBody(props: FilePreviewBodyProps) {
  const inlineKind = props.entry ? getInlineFilePreviewKind(props.entry.relativePath) : null;
  const mediaPreview = useAuthenticatedFilePreview({
    kind: inlineKind,
    sourceUrl: props.previewDownloadUrl ?? null,
    token: props.previewToken ?? null,
    mimeType: inlineKind === "pdf" ? "application/pdf" : null
  });

  if (!props.entry) {
    return null;
  }

  if (!inlineKind) {
    return renderFallbackBody(props.preview, props.isLoading === true);
  }

  if (mediaPreview.status === "loading" || mediaPreview.status === "idle") {
    return <LoadingIndicator center size={28} label="Loading preview…" delayMs={0} />;
  }

  if (mediaPreview.status === "error") {
    return (
      <div className="empty-hint" style={{ textAlign: "center", marginTop: "2rem" }}>
        <p>{mediaPreview.error}</p>
        <p className="muted-text" style={{ fontSize: "0.82rem" }}>
          Download the file to inspect it locally.
        </p>
      </div>
    );
  }

  if (inlineKind === "image") {
    return (
      <div
        style={{
          display: "grid",
          placeItems: "center",
          minHeight: "100%",
          paddingBottom: "0.5rem"
        }}
      >
        <img
          src={mediaPreview.objectUrl}
          alt={props.entry.name}
          style={{
            display: "block",
            maxWidth: "100%",
            maxHeight: "72vh",
            width: "auto",
            height: "auto",
            borderRadius: "0.9rem",
            background: "var(--surface-muted)",
            boxShadow: "0 20px 48px rgba(0, 0, 0, 0.12)"
          }}
        />
      </div>
    );
  }

  return (
    <object
      data={mediaPreview.objectUrl}
      type="application/pdf"
      aria-label={`${props.entry.name} preview`}
      style={{
        width: "100%",
        minHeight: "72vh",
        border: "1px solid var(--border)",
        borderRadius: "0.9rem",
        background: "white"
      }}
    >
      <div className="empty-hint" style={{ textAlign: "center", marginTop: "2rem" }}>
        <p>PDF preview is unavailable in this browser.</p>
        <p className="muted-text" style={{ fontSize: "0.82rem" }}>
          Use Download to open the file locally.
        </p>
      </div>
    </object>
  );
}

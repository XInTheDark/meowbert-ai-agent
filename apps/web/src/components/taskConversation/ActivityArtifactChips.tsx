import { FileText } from "lucide-react";

const VISIBLE_ARTIFACT_COUNT = 4;

function fileName(path: string): string {
  return path.split("/").filter(Boolean).pop() ?? path;
}

// Files the turn marked as artifacts. Rendered inside the card's button, so these are spans.
export function ActivityArtifactChips(props: { paths: string[] }): JSX.Element | null {
  if (props.paths.length === 0) {
    return null;
  }
  const visible = props.paths.slice(-VISIBLE_ARTIFACT_COUNT);
  const hiddenCount = props.paths.length - visible.length;

  return (
    <span className="tool-activity-artifacts" role="list" aria-label="Artifacts">
      {visible.map((path) => (
        <span key={path} className="tool-activity-artifact" role="listitem" title={path}>
          <FileText size={12} aria-hidden="true" />
          <span className="tool-activity-artifact-name">{fileName(path)}</span>
        </span>
      ))}
      {hiddenCount > 0 ? <span className="tool-activity-artifact-more">+{hiddenCount} more</span> : null}
    </span>
  );
}

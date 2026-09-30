import type { TaskSearchPreview as TaskSearchPreviewValue } from "@meowbert/shared/task-history-search";

interface TaskSearchPreviewProps {
  preview?: TaskSearchPreviewValue | null;
}

export function TaskSearchPreview({ preview }: TaskSearchPreviewProps) {
  if (!preview || preview.segments.length === 0) {
    return null;
  }

  return (
    <span className="task-result-preview">
      {preview.segments.map((segment, index) => (
        segment.highlight
          ? <strong key={index}>{segment.text}</strong>
          : <span key={index}>{segment.text}</span>
      ))}
    </span>
  );
}

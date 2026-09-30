import type { TaskFolderSummary } from "../../../lib/types";
import type { TaskFolderFilter } from "./projectOverviewTypes";
import { buildTaskFolderOptions } from "./taskFolderTree";

interface TaskFolderMoveDialogProps {
  title: string;
  folders: TaskFolderSummary[];
  currentFolderId?: string | null;
  disallowedFolderId?: string | null;
  confirmLabel?: string;
  onCancel: () => void;
  onConfirm: (folderId: string | null) => void;
}

export function TaskFolderMoveDialog(props: TaskFolderMoveDialogProps) {
  const options = buildTaskFolderOptions(props.folders)
    .filter((option) => option.value !== "all")
    .filter((option) => option.value !== props.disallowedFolderId);
  const initialValue: TaskFolderFilter = props.currentFolderId ?? "unfiled";

  return (
    <div className="task-folder-dialog-backdrop" role="presentation">
      <div className="task-folder-dialog" role="dialog" aria-modal="true" aria-labelledby="task-folder-dialog-title">
        <h3 id="task-folder-dialog-title">{props.title}</h3>
        <label className="task-filter-group">
          <span className="task-filter-label">Folder</span>
          <select
            className="toolbar-select task-folder-dialog-select"
            defaultValue={initialValue}
            onChange={(event) => {
              event.currentTarget.dataset.selectedFolderId = event.currentTarget.value;
            }}
          >
            {options.map((option) => (
              <option key={option.value} value={option.value}>
                {option.value === "unfiled" ? "Project root" : option.label}
              </option>
            ))}
          </select>
        </label>
        <div className="task-folder-dialog-actions">
          <button type="button" className="btn ghost" onClick={props.onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className="btn primary"
            onClick={(event) => {
              const select = event.currentTarget
                .closest(".task-folder-dialog")
                ?.querySelector<HTMLSelectElement>(".task-folder-dialog-select");
              const value = select?.value ?? initialValue;
              props.onConfirm(value === "unfiled" ? null : value);
            }}
          >
            {props.confirmLabel ?? "Move"}
          </button>
        </div>
      </div>
    </div>
  );
}

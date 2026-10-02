import { useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { Folder, Plus } from "lucide-react";
import type { Project } from "../../../lib/types";
import { badgeClass, formatRelative } from "../../../lib/utils";
import { DropdownDivider, DropdownItem } from "../overview/ProjectOverviewDropdown";
import { TaskActionsMenu } from "../overview/TaskActionsMenu";

export interface ProjectCardProps {
  project: Project;
  busy: boolean;
  isMenuOpen: boolean;
  onMenuOpenChange: (open: boolean) => void;
  onOpen: () => void;
  onPrefetch: () => void;
  onNewTask: () => void;
  onOpenFiles: () => void;
  onOpenSettings: () => void;
  onRename: (name: string) => Promise<void>;
  onToggleArchived: () => void;
}

// The whole card opens the project; less frequent actions live in the overflow menu.
export function ProjectCard(props: ProjectCardProps) {
  const { project } = props;
  const archived = project.status === "archived";
  const updatedAt = project.updated_at ?? project.created_at;
  const [isRenaming, setIsRenaming] = useState(false);

  function runMenuAction(action: () => void): void {
    props.onMenuOpenChange(false);
    action();
  }

  return (
    <article className={`workbench-panel project-card${archived ? " is-archived" : ""}`}>
      <span className="project-card-icon" aria-hidden="true">
        <Folder size={18} />
      </span>
      <div className="project-card-body">
        {isRenaming ? (
          <ProjectRenameField
            initialName={project.name}
            onCancel={() => setIsRenaming(false)}
            onSubmit={(name) => props.onRename(name).finally(() => setIsRenaming(false))}
          />
        ) : (
          <button
            type="button"
            className="project-card-title"
            onPointerEnter={props.onPrefetch}
            onFocus={props.onPrefetch}
            onClick={props.onOpen}
          >
            {project.name}
          </button>
        )}
        <div className="project-card-meta">
          {archived ? <span className={badgeClass(project.status)}>archived</span> : null}
          <span className="muted-text">{updatedAt ? `Updated ${formatRelative(updatedAt)}` : "Just created"}</span>
        </div>
      </div>
      <div className="project-card-actions">
        {!archived ? (
          <button
            type="button"
            className="btn ghost icon-btn"
            onClick={props.onNewTask}
            title="New task"
            aria-label={`New task in ${project.name}`}
          >
            <Plus size={16} />
          </button>
        ) : null}
        <TaskActionsMenu
          open={props.isMenuOpen}
          title="Project actions"
          disabled={props.busy}
          onToggle={() => props.onMenuOpenChange(!props.isMenuOpen)}
        >
          <DropdownItem onClick={() => runMenuAction(() => setIsRenaming(true))}>Rename</DropdownItem>
          <DropdownItem onClick={() => runMenuAction(props.onOpenFiles)}>Files</DropdownItem>
          <DropdownItem onClick={() => runMenuAction(props.onOpenSettings)}>Settings</DropdownItem>
          <DropdownDivider />
          <DropdownItem danger={!archived} onClick={() => runMenuAction(props.onToggleArchived)}>
            {archived ? "Restore" : "Archive"}
          </DropdownItem>
        </TaskActionsMenu>
      </div>
    </article>
  );
}

function ProjectRenameField(props: {
  initialName: string;
  onCancel: () => void;
  onSubmit: (name: string) => Promise<void>;
}) {
  const [name, setName] = useState(props.initialName);
  const [isSaving, setIsSaving] = useState(false);
  // Escape unmounts the field, which can fire blur; that blur must not save the draft.
  const cancelledRef = useRef(false);

  function submit(event?: FormEvent): void {
    event?.preventDefault();
    const trimmed = name.trim();
    if (isSaving || cancelledRef.current) return;
    if (!trimmed || trimmed === props.initialName) {
      props.onCancel();
      return;
    }
    setIsSaving(true);
    void props.onSubmit(trimmed);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key !== "Escape") return;
    cancelledRef.current = true;
    props.onCancel();
  }

  return (
    <form className="project-card-rename" onSubmit={submit}>
      <input
        autoFocus
        aria-label="Project name"
        value={name}
        disabled={isSaving}
        onChange={(event) => setName(event.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={() => submit()}
        onFocus={(event) => event.currentTarget.select()}
      />
    </form>
  );
}

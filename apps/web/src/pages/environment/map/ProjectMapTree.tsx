import { useState } from "react";
import { ChevronDown, ChevronRight, Folder, NotebookPen } from "lucide-react";
import type { ProjectMapFolder } from "@meowbert/shared/project-map";
import { ProjectMapCardItem, ProjectMapRollupBadges, ProjectMapSelectBox, ProjectMapTaskItem } from "./ProjectMapItems";
import { ProjectMapRowMenu } from "./ProjectMapRowMenu";
import { firstLine } from "./projectMapModel";
import type { ProjectMapViewContext } from "./projectMapViewContext";

const UNFILED_PAGE = 30;

export function folderMenuItems(ctx: ProjectMapViewContext, folder: ProjectMapFolder, extra: Array<{ label: string; onSelect: () => void }> = []) {
  return [
    ...extra,
    { label: "Edit note", onSelect: () => ctx.openDialog({ kind: "note", folderId: folder.id, folderName: folder.name, markdown: folder.note }) },
    { label: "New subfolder", onSelect: () => ctx.openDialog({ kind: "new-folder", parentFolderId: folder.id }) },
    { label: "New card", onSelect: () => ctx.openDialog({ kind: "new-card", folderId: folder.id }) },
    { label: "Rename", onSelect: () => ctx.openDialog({ kind: "rename-folder", folderId: folder.id, name: folder.name }) },
    { label: "Delete", danger: true, onSelect: () => ctx.deleteFolder(folder.id, folder.name) }
  ];
}

function FolderContents(props: { ctx: ProjectMapViewContext; folderId: string; depth: number; collapsed: Set<string>; onToggle: (id: string) => void }) {
  const contents = props.ctx.model.contents(props.folderId);
  return (
    <div className="project-map-children">
      {contents.folders.map((child) => <FolderNode key={child.id} {...props} folder={child} depth={props.depth + 1} />)}
      {contents.cards.map((card) => <ProjectMapCardItem key={card.id} ctx={props.ctx} card={card} variant="row" />)}
      {contents.tasks.map((task) => <ProjectMapTaskItem key={task.id} ctx={props.ctx} task={task} variant="row" />)}
    </div>
  );
}

function FolderNode(props: { ctx: ProjectMapViewContext; folder: ProjectMapFolder; depth: number; collapsed: Set<string>; onToggle: (id: string) => void }) {
  const { ctx, folder } = props;
  const open = !props.collapsed.has(folder.id);
  const note = firstLine(folder.note);
  const editNote = () => ctx.openDialog({ kind: "note", folderId: folder.id, folderName: folder.name, markdown: folder.note });
  return (
    <div className={`project-map-folder${ctx.drag.isOver(folder.id) ? " is-drop-target" : ""}`} {...ctx.drag.dropProps(folder.id)}>
      <div className={`project-map-item is-folder is-row${ctx.selection.isSelected(folder.id) ? " is-selected" : ""}`} {...ctx.drag.itemProps(folder.id)}>
        <ProjectMapSelectBox ctx={ctx} id={folder.id} label={folder.name} />
        <button type="button" className="project-map-folder-toggle" aria-expanded={open} onClick={() => props.onToggle(folder.id)}>
          {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          <Folder size={14} aria-hidden="true" />
          <span className="project-map-item-title">{folder.name}</span>
        </button>
        <ProjectMapRollupBadges rollup={ctx.model.rollups.get(folder.id)} />
        <ProjectMapRowMenu label={`More for ${folder.name}`} items={folderMenuItems(ctx, folder)} />
      </div>
      {open ? <>
        <button type="button" className={`project-map-note-preview${note ? "" : " is-empty"}`} onClick={editNote}>
          <NotebookPen size={12} aria-hidden="true" /> {note || "Add a note"}
        </button>
        <FolderContents {...props} folderId={folder.id} />
      </> : null}
    </div>
  );
}

export function ProjectMapTree(props: { ctx: ProjectMapViewContext }) {
  const { ctx } = props;
  const [collapsed, setCollapsed] = useState(() => new Set<string>());
  const [unfiledShown, setUnfiledShown] = useState(UNFILED_PAGE);
  const top = ctx.model.contents(null);
  const toggle = (id: string) => setCollapsed((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  return (
    <div className="project-map-tree">
      {top.folders.map((folder) => <FolderNode key={folder.id} ctx={ctx} folder={folder} depth={0} collapsed={collapsed} onToggle={toggle} />)}
      {top.cards.map((card) => <ProjectMapCardItem key={card.id} ctx={ctx} card={card} variant="row" />)}
      <div className={`project-map-unfiled${ctx.drag.isOver(null) ? " is-drop-target" : ""}`} {...ctx.drag.dropProps(null)}>
        <div className="project-map-section-label">Unfiled {top.tasks.length ? `(${top.tasks.length})` : ""}</div>
        {top.tasks.length === 0 ? <p className="project-map-empty-hint">Tasks outside any folder show here.</p> : null}
        {top.tasks.slice(0, unfiledShown).map((task) => <ProjectMapTaskItem key={task.id} ctx={ctx} task={task} variant="row" />)}
        {top.tasks.length > unfiledShown ? (
          <button type="button" className="btn ghost project-map-more" onClick={() => setUnfiledShown(unfiledShown + UNFILED_PAGE)}>Show more</button>
        ) : null}
      </div>
    </div>
  );
}

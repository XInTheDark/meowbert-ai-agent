import { ChevronRight, CornerDownRight, Folder, NotebookPen } from "lucide-react";
import type { ProjectMapFolder } from "@meowbert/shared/project-map";
import { ProjectMapCardItem, ProjectMapRollupBadges, ProjectMapTaskItem } from "./ProjectMapItems";
import { ProjectMapRowMenu } from "./ProjectMapRowMenu";
import { folderMenuItems } from "./ProjectMapTree";
import { firstLine } from "./projectMapModel";
import type { ProjectMapViewContext } from "./projectMapViewContext";

const LOOSE_TASK_LIMIT = 50;

function Breadcrumb(props: { ctx: ProjectMapViewContext; rootId: string | null; onOpen: (folderId: string | null) => void }) {
  const trail = props.ctx.model.path(props.rootId);
  return (
    <nav className="project-map-breadcrumb" aria-label="Board folder">
      <button type="button" onClick={() => props.onOpen(null)} aria-current={props.rootId === null ? "page" : undefined}>Project</button>
      {trail.map((folder) => (
        <span key={folder.id}>
          <ChevronRight size={13} aria-hidden="true" />
          <button type="button" onClick={() => props.onOpen(folder.id)} aria-current={folder.id === props.rootId ? "page" : undefined}>{folder.name}</button>
        </span>
      ))}
    </nav>
  );
}

function ColumnItems(props: { ctx: ProjectMapViewContext; folderId: string | null; onOpen: (folderId: string) => void }) {
  const contents = props.ctx.model.contents(props.folderId);
  const empty = !contents.folders.length && !contents.cards.length && !contents.tasks.length;
  return (
    <div className="project-map-column-items">
      {contents.folders.map((child) => (
        <button key={child.id} type="button" className="project-map-subfolder" onClick={() => props.onOpen(child.id)} {...props.ctx.drag.itemProps(child.id)}>
          <CornerDownRight size={13} aria-hidden="true" /><Folder size={13} aria-hidden="true" /> <span>{child.name}</span>
          <ProjectMapRollupBadges rollup={props.ctx.model.rollups.get(child.id)} />
        </button>
      ))}
      {contents.cards.map((card) => <ProjectMapCardItem key={card.id} ctx={props.ctx} card={card} variant="card" />)}
      {contents.tasks.map((task) => <ProjectMapTaskItem key={task.id} ctx={props.ctx} task={task} variant="card" />)}
      {empty ? <p className="project-map-empty-hint">Drop items here.</p> : null}
    </div>
  );
}

function FolderColumn(props: { ctx: ProjectMapViewContext; folder: ProjectMapFolder; onOpen: (folderId: string) => void }) {
  const { ctx, folder } = props;
  const note = firstLine(folder.note);
  return (
    <section className={`project-map-column${ctx.drag.isOver(folder.id) ? " is-drop-target" : ""}`} {...ctx.drag.dropProps(folder.id)} aria-label={folder.name}>
      <header className="project-map-column-header" {...ctx.drag.itemProps(folder.id)}>
        <button type="button" className="project-map-column-title" onClick={() => props.onOpen(folder.id)} title="Open as board">{folder.name}</button>
        <ProjectMapRollupBadges rollup={ctx.model.rollups.get(folder.id)} />
        <ProjectMapRowMenu label={`More for ${folder.name}`} items={folderMenuItems(ctx, folder)} />
      </header>
      <button type="button" className={`project-map-note-preview${note ? "" : " is-empty"}`}
        onClick={() => ctx.openDialog({ kind: "note", folderId: folder.id, folderName: folder.name, markdown: folder.note })}>
        <NotebookPen size={12} aria-hidden="true" /> {note || "Add a note"}
      </button>
      <ColumnItems ctx={ctx} folderId={folder.id} onOpen={props.onOpen} />
    </section>
  );
}

// Columns are the subfolders of the open folder. Items sitting directly in it get a column of their own.
export function ProjectMapBoard(props: { ctx: ProjectMapViewContext; rootId: string | null; onOpen: (folderId: string | null) => void }) {
  const { ctx, rootId } = props;
  const contents = ctx.model.contents(rootId);
  const looseCount = contents.cards.length + contents.tasks.length;
  const looseLabel = rootId === null ? "Unfiled" : "In this folder";
  const root = rootId ? ctx.model.folder(rootId) : undefined;
  return (
    <div className="project-map-board-shell">
      <Breadcrumb ctx={ctx} rootId={rootId} onOpen={props.onOpen} />
      {root ? (
        <button type="button" className={`project-map-note-preview is-board-root${root.note.trim() ? "" : " is-empty"}`}
          onClick={() => ctx.openDialog({ kind: "note", folderId: root.id, folderName: root.name, markdown: root.note })}>
          <NotebookPen size={12} aria-hidden="true" /> {firstLine(root.note) || "Add a note"}
        </button>
      ) : null}
      <div className="project-map-board">
        {contents.folders.map((folder) => <FolderColumn key={folder.id} ctx={ctx} folder={folder} onOpen={props.onOpen} />)}
        <section className={`project-map-column is-loose${ctx.drag.isOver(rootId) ? " is-drop-target" : ""}`} {...ctx.drag.dropProps(rootId)} aria-label={looseLabel}>
          <header className="project-map-column-header"><span className="project-map-column-title">{looseLabel}</span>
            {looseCount ? <span className="project-map-count">{looseCount}</span> : null}</header>
          <div className="project-map-column-items">
            {contents.cards.map((card) => <ProjectMapCardItem key={card.id} ctx={ctx} card={card} variant="card" />)}
            {contents.tasks.slice(0, LOOSE_TASK_LIMIT).map((task) => <ProjectMapTaskItem key={task.id} ctx={ctx} task={task} variant="card" />)}
            {contents.tasks.length > LOOSE_TASK_LIMIT
              ? <p className="project-map-empty-hint">{contents.tasks.length - LOOSE_TASK_LIMIT} older tasks are in the Tree view.</p> : null}
            {!looseCount ? <p className="project-map-empty-hint">Drop items here.</p> : null}
          </div>
        </section>
      </div>
    </div>
  );
}

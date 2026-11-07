import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { X } from "lucide-react";
import type { ProjectMapCard, ProjectMapCardState } from "@meowbert/shared/project-map";

export type ProjectMapDialog =
  | { kind: "brief"; markdown: string }
  | { kind: "note"; folderId: string; folderName: string; markdown: string }
  | { kind: "new-folder"; parentFolderId: string | null }
  | { kind: "rename-folder"; folderId: string; name: string }
  | { kind: "new-card"; folderId: string | null }
  | { kind: "edit-card"; card: ProjectMapCard };

export interface ProjectMapDialogActions {
  saveBrief: (markdown: string) => Promise<boolean>;
  saveNote: (folderId: string, markdown: string) => Promise<boolean>;
  createFolder: (name: string, parentFolderId: string | null) => Promise<boolean>;
  renameFolder: (folderId: string, name: string) => Promise<boolean>;
  createCard: (folderId: string | null, card: CardFields) => Promise<boolean>;
  updateCard: (cardId: string, card: CardFields) => Promise<boolean>;
}

interface CardFields { title: string; body: string; state: ProjectMapCardState }

function DialogFrame(props: { title: string; onClose: () => void; onSubmit: () => Promise<boolean>; children: ReactNode; wide?: boolean }) {
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape" && !saving) props.onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [props.onClose, saving]);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    const saved = await props.onSubmit();
    setSaving(false);
    if (saved) props.onClose();
  }
  return (
    <div className="legal-overlay" onClick={() => !saving && props.onClose()}>
      <div className="legal-modal project-map-dialog" style={{ maxWidth: props.wide ? "44rem" : "28rem" }} onClick={(event) => event.stopPropagation()}>
        <div className="legal-modal-header">
          <h2>{props.title}</h2>
          <button className="legal-close" onClick={props.onClose} aria-label="Close" disabled={saving}><X size={18} /></button>
        </div>
        <form className="legal-modal-body" onSubmit={(event) => void submit(event)}>
          {props.children}
          <div className="computer-use-modal-footer">
            <button className="btn ghost" type="button" onClick={props.onClose} disabled={saving}>Cancel</button>
            <button className="btn primary" type="submit" disabled={saving}>{saving ? "Saving..." : "Save"}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function NoteDialog(props: { title: string; initial: string; placeholder: string; onClose: () => void; onSave: (markdown: string) => Promise<boolean> }) {
  const [value, setValue] = useState(props.initial);
  return (
    <DialogFrame title={props.title} onClose={props.onClose} onSubmit={() => props.onSave(value)} wide>
      <textarea className="project-map-note-input" value={value} onChange={(event) => setValue(event.target.value)}
        rows={16} autoFocus placeholder={props.placeholder} aria-label={props.title} />
    </DialogFrame>
  );
}

function NameDialog(props: { title: string; initial: string; onClose: () => void; onSave: (name: string) => Promise<boolean> }) {
  const [value, setValue] = useState(props.initial);
  return (
    <DialogFrame title={props.title} onClose={props.onClose} onSubmit={() => value.trim() ? props.onSave(value.trim()) : Promise.resolve(false)}>
      <input value={value} onChange={(event) => setValue(event.target.value)} autoFocus maxLength={120} aria-label="Folder name" />
    </DialogFrame>
  );
}

function CardDialog(props: { title: string; initial: CardFields; onClose: () => void; onSave: (card: CardFields) => Promise<boolean> }) {
  const [card, setCard] = useState(props.initial);
  return (
    <DialogFrame title={props.title} onClose={props.onClose} onSubmit={() => card.title.trim() ? props.onSave({ ...card, title: card.title.trim() }) : Promise.resolve(false)}>
      <input value={card.title} onChange={(event) => setCard({ ...card, title: event.target.value })} autoFocus maxLength={240}
        placeholder="What needs doing" aria-label="Card title" />
      <textarea value={card.body} onChange={(event) => setCard({ ...card, body: event.target.value })} rows={6}
        placeholder="Details (optional)" aria-label="Card details" />
      <div className="project-map-state-picker" role="radiogroup" aria-label="Card state">
        {(["idea", "next", "done"] as const).map((state) => (
          <button key={state} type="button" role="radio" aria-checked={card.state === state}
            className={card.state === state ? "is-active" : ""} onClick={() => setCard({ ...card, state })}>
            {state === "idea" ? "Idea" : state === "next" ? "Next" : "Done"}
          </button>
        ))}
      </div>
    </DialogFrame>
  );
}

export function ProjectMapDialogs(props: { dialog: ProjectMapDialog | null; onClose: () => void; actions: ProjectMapDialogActions }) {
  const { dialog, onClose, actions } = props;
  if (!dialog) return null;
  switch (dialog.kind) {
    case "brief":
      return <NoteDialog title="Project brief" initial={dialog.markdown} onClose={onClose} onSave={actions.saveBrief}
        placeholder="The goal, the main streams of work, and what is waiting on you." />;
    case "note":
      return <NoteDialog title={`Note: ${dialog.folderName}`} initial={dialog.markdown} onClose={onClose}
        onSave={(markdown) => actions.saveNote(dialog.folderId, markdown)} placeholder="Decisions, open questions and context for this folder." />;
    case "new-folder":
      return <NameDialog title="New folder" initial="" onClose={onClose} onSave={(name) => actions.createFolder(name, dialog.parentFolderId)} />;
    case "rename-folder":
      return <NameDialog title="Rename folder" initial={dialog.name} onClose={onClose} onSave={(name) => actions.renameFolder(dialog.folderId, name)} />;
    case "new-card":
      return <CardDialog title="New card" initial={{ title: "", body: "", state: "idea" }} onClose={onClose}
        onSave={(card) => actions.createCard(dialog.folderId, card)} />;
    case "edit-card":
      return <CardDialog title="Edit card" initial={dialog.card} onClose={onClose} onSave={(card) => actions.updateCard(dialog.card.id, card)} />;
  }
}

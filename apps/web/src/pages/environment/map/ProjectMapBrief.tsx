import { useState } from "react";
import { ChevronDown, ChevronRight, Pencil } from "lucide-react";
import { ConversationMessageContent } from "../../../components/taskConversation/ConversationMessageContent";
import { buildDefaultTaskAssistantMessageDisplayPreferences } from "../../../task/taskPagePreferences";

const preferences = { ...buildDefaultTaskAssistantMessageDisplayPreferences(), renderMarkdown: true, collapseLongMessages: false };
const STORAGE_KEY = "meowbert_project_map_brief_open";

function readOpen(): boolean {
  try { return window.localStorage.getItem(STORAGE_KEY) !== "false"; } catch { return true; }
}

// The project brief above the tree or board: the top-level note the Master keeps.
export function ProjectMapBrief(props: { markdown: string; onEdit: () => void }) {
  const [open, setOpen] = useState(readOpen);
  function toggle() {
    setOpen(!open);
    try { window.localStorage.setItem(STORAGE_KEY, String(!open)); } catch { /* Storage may be unavailable. */ }
  }
  return (
    <section className="project-map-brief" aria-label="Project brief">
      <div className="project-map-brief-header">
        <button type="button" className="project-map-brief-toggle" aria-expanded={open} onClick={toggle}>
          {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />} Brief
        </button>
        <button type="button" className="icon-btn-subtle" aria-label="Edit brief" title="Edit brief" onClick={props.onEdit}><Pencil size={14} /></button>
      </div>
      {open ? (
        props.markdown.trim()
          ? <div className="project-map-brief-body"><ConversationMessageContent content={props.markdown} displayPreferences={preferences} forceExpanded /></div>
          : <button type="button" className="project-map-empty-hint project-map-brief-empty" onClick={props.onEdit}>
            No brief yet. The Master writes one as work starts, or you can add it.
          </button>
      ) : null}
    </section>
  );
}

import { Code, FileText, Globe, Search, Sparkles, Terminal, Zap } from "lucide-react";
import type { ProjectSuggestedAction } from "@meowbert/shared/memory";

function SuggestedActionIcon({ name }: { name?: string }) {
  switch (name) {
    case "code":
      return <Code size={14} />;
    case "globe":
      return <Globe size={14} />;
    case "terminal":
      return <Terminal size={14} />;
    case "search":
      return <Search size={14} />;
    case "zap":
      return <Zap size={14} />;
    case "file-text":
      return <FileText size={14} />;
    case "sparkles":
    default:
      return <Sparkles size={14} />;
  }
}

// A row of project starter actions; picking one hands its prompt to the caller's composer.
export function SuggestedActionPills(props: {
  actions: ProjectSuggestedAction[];
  onSelect: (action: ProjectSuggestedAction) => void;
  className?: string;
}) {
  if (props.actions.length === 0) return null;
  return (
    <div className={props.className ?? "task-composer-starters"}>
      {props.actions.map((action, index) => (
        <button
          key={action.id || `${action.label}-${index}`}
          type="button"
          className="task-composer-starter-pill"
          onClick={() => props.onSelect(action)}
        >
          <SuggestedActionIcon name={action.icon} />
          <span>{action.label}</span>
        </button>
      ))}
    </div>
  );
}

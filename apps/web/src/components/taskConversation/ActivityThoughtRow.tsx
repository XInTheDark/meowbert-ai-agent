import { useState } from "react";
import { ChevronRight } from "lucide-react";
import type { TaskAssistantMessageDisplayPreferences } from "../../lib/types";
import { ConversationMessageContent } from "./ConversationMessageContent";
import type { ActivityThought } from "./conversationActivityEntries";

// Reasoning summaries usually open with a bold heading line; that line makes the best one-line preview.
function getThoughtPreview(content: string): string {
  const firstLine = content.split("\n").find((line) => line.trim().length > 0) ?? "";
  return firstLine.trim().replace(/^#+\s*/, "").replace(/^\*\*(.+?)\*\*:?$/, "$1");
}

export function ActivityThoughtRow(props: {
  thoughts: ActivityThought[];
  displayPreferences: TaskAssistantMessageDisplayPreferences;
}): JSX.Element {
  const [isOpen, setIsOpen] = useState(false);
  const content = props.thoughts.map((thought) => thought.content).join("\n\n");

  return (
    <details className="activity-thought-row" open={isOpen} onToggle={(event) => setIsOpen(event.currentTarget.open)}>
      <summary className="activity-thought-summary">
        <ChevronRight size={13} className="activity-thought-chevron" aria-hidden="true" />
        <span className="activity-thought-preview">{getThoughtPreview(content)}</span>
      </summary>
      {isOpen ? (
        <div className="activity-thought-content markdown-content">
          <ConversationMessageContent content={content} displayPreferences={props.displayPreferences} />
        </div>
      ) : null}
    </details>
  );
}

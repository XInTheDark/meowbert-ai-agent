import { useState } from "react";
import type { TaskAssistantMessageDisplayPreferences } from "../../lib/types";
import { ConversationMessageContent } from "./ConversationMessageContent";

export interface ThoughtSummaryContentProps {
  label: string;
  content: string;
  displayPreferences: TaskAssistantMessageDisplayPreferences;
  defaultOpen?: boolean;
}

export function ThoughtSummaryContent(props: ThoughtSummaryContentProps): JSX.Element {
  const [isOpen, setIsOpen] = useState(props.defaultOpen ?? false);

  return (
    <details
      className="thought-details"
      open={isOpen}
      onToggle={(event) => setIsOpen(event.currentTarget.open)}
    >
      <summary className="thought-summary">
        <span className="thought-label-text">{props.label}</span>
      </summary>
      {isOpen ? (
        <div className="thought-group-content markdown-content">
          <ConversationMessageContent content={props.content} displayPreferences={props.displayPreferences} />
        </div>
      ) : null}
    </details>
  );
}

export function ThoughtSummaryBubble(props: ThoughtSummaryContentProps): JSX.Element {
  return (
    <div className="chat-bubble thought-group">
      <ThoughtSummaryContent {...props} />
    </div>
  );
}

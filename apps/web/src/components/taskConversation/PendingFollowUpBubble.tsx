import { useLayoutEffect, useRef } from "react";
import type { TaskAssistantMessageDisplayPreferences } from "../../lib/types";
import { normalizeTaskAssistantMessageDisplayPreferences } from "../../task/taskPagePreferences";
import { ConversationMessageContent } from "./ConversationMessageContent";
import { splitSelectedTextMessage } from "./selectedTextQuoteUtils";
import { SelectedTextQuoteCard } from "./SelectedTextQuoteCard";

// The user's message while it is being sent, styled like the stored message that replaces it.
export function PendingFollowUpBubble(props: {
  text: string;
  displayPreferences: TaskAssistantMessageDisplayPreferences;
}) {
  const bubbleRef = useRef<HTMLDivElement>(null);
  const preferences = normalizeTaskAssistantMessageDisplayPreferences(props.displayPreferences);
  const selectedTextMessage = splitSelectedTextMessage(props.text);
  const visibleContent = selectedTextMessage?.message ?? props.text;

  useLayoutEffect(() => {
    bubbleRef.current?.scrollIntoView({ block: "end" });
  }, [props.text]);

  return (
    <div ref={bubbleRef} className="chat-bubble user pending" aria-busy="true">
      <div className="bubble-content markdown-content">
        {selectedTextMessage ? (
          <div className="selected-text-quote-list sent-quote-list">
            {selectedTextMessage.quotes.map((quote, index) => (
              <SelectedTextQuoteCard
                key={`${quote.location ?? "quote"}:${index}:${quote.text.slice(0, 24)}`}
                quote={quote}
                index={index + 1}
              />
            ))}
          </div>
        ) : null}
        {visibleContent ? (
          <ConversationMessageContent
            content={visibleContent}
            displayPreferences={{
              ...preferences,
              renderMarkdown: preferences.renderUserMessages,
              hideCitationMarkers: false
            }}
            enableLongMessageCollapse
          />
        ) : null}
      </div>
    </div>
  );
}

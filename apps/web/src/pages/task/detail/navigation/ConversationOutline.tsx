import { useEffect, useRef, useState } from "react";
import { ArrowDown } from "lucide-react";
import { ConversationMessageContent } from "../../../../components/taskConversation/ConversationMessageContent";
import { buildDefaultTaskAssistantMessageDisplayPreferences } from "../../../../task/taskPagePreferences";

const preferences = { ...buildDefaultTaskAssistantMessageDisplayPreferences(), renderMarkdown: true, collapseLongMessages: false };

export function ConversationOutline(props: { markdown: string | null; onJump: (id: string) => void }) {
  const feed = useRef<HTMLDivElement>(null);
  const [hasMore, setHasMore] = useState(false);
  function measure() {
    const element = feed.current;
    if (element) setHasMore(element.scrollHeight - element.scrollTop - element.clientHeight > 80);
  }
  useEffect(() => {
    measure();
    if (!feed.current || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure); observer.observe(feed.current);
    if (feed.current.firstElementChild) observer.observe(feed.current.firstElementChild);
    return () => observer.disconnect();
  }, [props.markdown]);
  return <div className="conversation-outline">
    <div className="conversation-outline-body" ref={feed} onScroll={measure} onClickCapture={(event) => {
      const anchor = event.target instanceof Element ? event.target.closest("a") : null;
      const match = /^#message-([0-9a-f-]{36})$/i.exec(anchor?.getAttribute("href") ?? "");
      if (match) { event.preventDefault(); event.stopPropagation(); props.onJump(match[1]); }
    }}>
      {props.markdown ? <ConversationMessageContent content={props.markdown} displayPreferences={preferences} forceExpanded />
        : <p className="muted-text">An outline will appear when the assistant organizes this conversation.</p>}
    </div>
    {hasMore ? <button className="conversation-outline-bottom icon-btn-subtle" aria-label="Jump to bottom of outline"
      onClick={() => feed.current?.scrollTo({ top: feed.current.scrollHeight, behavior: "smooth" })}><ArrowDown size={18} /></button> : null}
  </div>;
}

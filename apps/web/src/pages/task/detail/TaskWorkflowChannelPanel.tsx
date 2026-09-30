import { useEffect, useRef, useState } from "react";
import type { ApiClient } from "../../../lib/api";
import { InlineProgressBar } from "../../../components/InlineProgressBar";
import type { SwarmChannelMessage } from "../../../lib/types";
import { formatRelative } from "../../../lib/utils";
import { formatSwarmSenderLabel } from "./taskWorkflowSidebarTypes";

const CHANNEL_POLL_INTERVAL_MS = 3000;

interface TaskWorkflowChannelPanelProps {
  api: ApiClient;
  taskId: string;
  channelId: string;
  channelTitle: string | null;
  channelKind: string;
  memberCount: number;
}

function ChannelMessageCard({ message }: { message: SwarmChannelMessage }) {
  const senderLabel = formatSwarmSenderLabel(message);
  const isSystem = senderLabel === "System";

  return (
    <article className={`workflow-channel-msg-card${isSystem ? " system" : ""}`}>
      <div className="workflow-channel-msg-header">
        <div className="workflow-channel-msg-sender">
          <span className={`badge ${isSystem ? "muted" : "brand"}`}>{senderLabel}</span>
          <span className="workflow-channel-msg-no">#{message.message_no}</span>
        </div>
        <span className="muted-text workflow-channel-msg-time">{formatRelative(message.created_at)}</span>
      </div>
      <div className="workflow-channel-msg-content">
        {message.content_markdown || <span className="muted-text">Empty message</span>}
      </div>
    </article>
  );
}

export function TaskWorkflowChannelPanel(props: TaskWorkflowChannelPanelProps) {
  const [messages, setMessages] = useState<SwarmChannelMessage[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const feedRef = useRef<HTMLDivElement>(null);
  const initialScrollDoneRef = useRef(false);

  useEffect(() => {
    let cancelled = false;

    const loadMessages = async () => {
      try {
        if (!cancelled) setError(null);
        const response = await props.api.get<{ items: SwarmChannelMessage[] }>(
          `/api/tasks/${props.taskId}/workflow/channels/${props.channelId}/messages`
        );
        if (cancelled) return;
        setMessages(response.items);
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : String(loadError));
          setMessages([]);
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };

    void loadMessages();
    const interval = window.setInterval(() => {
      void loadMessages();
    }, CHANNEL_POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [props.api, props.channelId, props.taskId]);

  useEffect(() => {
    initialScrollDoneRef.current = false;
  }, [props.channelId]);

  useEffect(() => {
    if (isLoading || error || initialScrollDoneRef.current || !feedRef.current) return;
    initialScrollDoneRef.current = true;
    const feed = feedRef.current;
    feed.scrollTop = feed.scrollHeight;
  }, [error, isLoading, messages.length]);

  return (
    <div className="workflow-channel-sidebar-pane">
      {isLoading && messages.length === 0 ? <InlineProgressBar pin="top" /> : null}
      {error ? <div className="error-text" style={{ padding: "0.8rem" }}>{error}</div> : null}
      {!isLoading && !error && messages.length === 0 ? (
        <div className="muted-text" style={{ padding: "1rem", textAlign: "center" }}>
          No messages in this channel yet.
        </div>
      ) : null}

      <div ref={feedRef} className="workflow-channel-messages-feed">
        {messages.map((message) => (
          <ChannelMessageCard key={message.id} message={message} />
        ))}
      </div>
    </div>
  );
}

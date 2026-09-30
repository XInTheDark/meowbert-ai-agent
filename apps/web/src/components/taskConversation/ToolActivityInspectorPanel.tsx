import { useEffect, type CSSProperties } from "react";
import { Activity, Clock3, X } from "lucide-react";
import { ThoughtSummaryContent } from "./ThoughtSummaryBubble";
import { ToolOutput } from "./ToolOutput";
import type { LiveToolCall } from "../../lib/types";
import {
  getLiveToolCallsPreview,
  getLiveToolDisclosureKey,
  getToolGroupSummary,
  getToolMessageDisclosureKey,
  type ToolInspectorSelection
} from "./shared";
import { ActivityNoticesList } from "./ActivityNoticesList";
import { useToolInspectorScroll } from "./useToolInspectorScroll";

export type { ToolInspectorSelection };

function formatInspectorTimestamp(value: string | null): string | null {
  if (!value) {
    return null;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(date);
}

function renderMetaPill(icon: JSX.Element, label: string): JSX.Element {
  return (
    <span className="tool-inspector-meta-pill">
      {icon}
      {label}
    </span>
  );
}

interface ToolInspectorHeaderProps {
  kicker: string;
  title: string;
  countLabel: string | null;
  preview: string | null;
  timestamp: string | null;
  onClose: () => void;
}

function ToolInspectorHeader(props: ToolInspectorHeaderProps): JSX.Element {
  return (
    <header className="tool-inspector-header">
      <div className="tool-inspector-header-copy">
        <div className="tool-inspector-kicker">
          <Activity size={14} />
          {props.kicker}
        </div>
        <h2>{props.title}</h2>
        {props.countLabel || props.preview || props.timestamp ? (
          <div className="tool-inspector-meta-row">
            {props.countLabel ? renderMetaPill(<Activity size={13} />, props.countLabel) : null}
            {props.preview ? renderMetaPill(<Clock3 size={13} />, props.preview) : null}
            {props.timestamp ? renderMetaPill(<Clock3 size={13} />, props.timestamp) : null}
          </div>
        ) : null}
      </div>
      <button
        type="button"
        className="tool-inspector-close-btn"
        aria-label="Close activity panel"
        title="Close activity panel"
        onClick={props.onClose}
      >
        <X size={16} />
      </button>
    </header>
  );
}

interface ToolInspectorLiveBodyProps {
  liveToolCalls: LiveToolCall[];
  toolDisclosureState: Record<string, boolean>;
  interruptingLiveToolCallIds: string[];
  onToolDisclosureChange: (key: string, open: boolean) => void;
  onInterruptLiveToolCall?: (liveCall: LiveToolCall) => void;
}

function ToolInspectorLiveBody(props: ToolInspectorLiveBodyProps): JSX.Element {
  return (
    <div className="tool-inspector-section">
      <div className="tool-inspector-section-heading">Live tools</div>
      <div className="tool-inspector-call-list">
        {props.liveToolCalls.map((liveCall, index) => (
          <div
            key={liveCall.id}
            className="tool-inspector-call-item"
            style={{ "--tool-call-index": `${index}` } as CSSProperties}
          >
            <ToolOutput
              liveCall={liveCall}
              onInterruptRequested={props.onInterruptLiveToolCall}
              interruptPending={props.interruptingLiveToolCallIds.includes(liveCall.id)}
              open={props.toolDisclosureState[getLiveToolDisclosureKey(liveCall)] ?? false}
              onOpenChange={(open) =>
                props.onToolDisclosureChange(getLiveToolDisclosureKey(liveCall), open)
              }
            />
          </div>
        ))}
      </div>
    </div>
  );
}

interface ToolInspectorHistoricalBodyProps {
  selection: Extract<ToolInspectorSelection, { kind: "historical" }>;
  hydratedMessageIds: Set<string>;
  toolDisclosureState: Record<string, boolean>;
  onToolDisclosureChange: (key: string, open: boolean) => void;
  onExpandRequested?: (messageIds: string[]) => void;
}

function isSyntheticResponseToolMessageId(id: string): boolean {
  return id.includes(":response-tool:");
}

function ToolInspectorHistoricalBody(props: ToolInspectorHistoricalBodyProps): JSX.Element {
  const { selection, hydratedMessageIds, onExpandRequested } = props;
  const messageIds = selection.toolGroup.map((toolMessage) => toolMessage.id);
  const realUnhydratedIds = messageIds.filter(
    (messageId) => !isSyntheticResponseToolMessageId(messageId) && !hydratedMessageIds.has(messageId)
  );
  const unhydratedKey = realUnhydratedIds.join(",");
  const hasAnyHydrated = messageIds.some(
    (messageId) => isSyntheticResponseToolMessageId(messageId) || hydratedMessageIds.has(messageId)
  );

  useEffect(() => {
    if (unhydratedKey) {
      onExpandRequested?.(unhydratedKey.split(","));
    }
  }, [onExpandRequested, unhydratedKey]);

  const showLoading = messageIds.length > 0 && !hasAnyHydrated;

  return (
    <>
      {selection.thoughtSummary ? (
        <section className="tool-inspector-summary-card">
          <div className="tool-inspector-section-heading">Reasoning summary</div>
          <ThoughtSummaryContent key={selection.groupKey} {...selection.thoughtSummary} defaultOpen />
        </section>
      ) : null}
      <div className="tool-inspector-section">
        <div className="tool-inspector-section-heading">Tool calls</div>
        {showLoading ? (
          <div className="tool-inspector-loading">
            <div className="tool-inspector-loading-dot" aria-hidden="true" />
            <span>Loading tool calls…</span>
          </div>
        ) : (
          <div className="tool-inspector-call-list">
            {selection.toolGroup.map((toolMessage, index) => (
              <div
                key={toolMessage.id}
                className="tool-inspector-call-item"
                style={{ "--tool-call-index": `${index}` } as CSSProperties}
              >
                <ToolOutput
                  message={toolMessage}
                  open={props.toolDisclosureState[getToolMessageDisclosureKey(toolMessage)] ?? false}
                  onOpenChange={(open) => {
                    props.onToolDisclosureChange(getToolMessageDisclosureKey(toolMessage), open);
                  }}
                />
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

export interface ToolActivityInspectorPanelProps {
  selection: ToolInspectorSelection | null;
  hydratedMessageIds: Set<string>;
  toolDisclosureState: Record<string, boolean>;
  interruptingLiveToolCallIds: string[];
  onClose: () => void;
  onToolDisclosureChange: (key: string, open: boolean) => void;
  onInterruptLiveToolCall?: (liveCall: LiveToolCall) => void;
  onExpandRequested?: (messageIds: string[]) => void;
  variant?: "overlay" | "docked";
}

function getToolInspectorContent(props: ToolActivityInspectorPanelProps & { selection: ToolInspectorSelection }): { headerElement: JSX.Element; bodyElement: JSX.Element } {
  const { selection } = props;
  let headerElement: JSX.Element;
  let bodyElement: JSX.Element;

  if (selection.kind === "live") {
    const preview = getLiveToolCallsPreview(selection.liveToolCalls);
    const firstStartedAt = selection.liveToolCalls[0]?.startedAt ?? null;
    headerElement = (
      <ToolInspectorHeader
        kicker="Running now"
        title={`${selection.liveToolCalls.length} active call${selection.liveToolCalls.length !== 1 ? "s" : ""}`}
        countLabel={`${selection.liveToolCalls.length} calls`}
        preview={preview}
        timestamp={firstStartedAt ? formatInspectorTimestamp(firstStartedAt) ?? "Now" : null}
        onClose={props.onClose}
      />
    );
    bodyElement = (
      <ToolInspectorLiveBody
        liveToolCalls={selection.liveToolCalls}
        toolDisclosureState={props.toolDisclosureState}
        interruptingLiveToolCallIds={props.interruptingLiveToolCallIds}
        onToolDisclosureChange={props.onToolDisclosureChange}
        onInterruptLiveToolCall={props.onInterruptLiveToolCall}
      />
    );
  } else if (selection.view === "notices") {
    const notices = selection.notices ?? [];
    headerElement = <ToolInspectorHeader kicker="Errors & recovery" title={`${notices.length} notice${notices.length === 1 ? "" : "s"}`}
      countLabel={null} preview={null} timestamp={null} onClose={props.onClose} />;
    bodyElement = <ActivityNoticesList notices={notices} />;
  } else {
    const summary = getToolGroupSummary(selection.toolGroup);
    const createdAt = selection.toolGroup[0]?.created_at ?? null;
    headerElement = (
      <ToolInspectorHeader
        kicker="Activity"
        title={summary.label}
        countLabel={`${summary.count} calls`}
        preview={summary.preview}
        timestamp={createdAt ? formatInspectorTimestamp(createdAt) ?? "Recent" : null}
        onClose={props.onClose}
      />
    );
    bodyElement = (
      <ToolInspectorHistoricalBody
        selection={selection}
        hydratedMessageIds={props.hydratedMessageIds}
        toolDisclosureState={props.toolDisclosureState}
        onToolDisclosureChange={props.onToolDisclosureChange}
        onExpandRequested={props.onExpandRequested}
      />
    );
  }

  return { headerElement, bodyElement };
}

export function ToolActivityInspectorPanel(props: ToolActivityInspectorPanelProps): JSX.Element | null {
  const { selection } = props;
  const variant = props.variant ?? "overlay";

  const itemCount = selection
    ? selection.kind === "live"
      ? selection.liveToolCalls.length
      : selection.view === "notices" ? selection.notices?.length ?? 0 : selection.toolGroup.length
    : 0;

  const { bodyRef, handleScroll } = useToolInspectorScroll({
    groupKey: selection ? `${selection.groupKey}:${selection.kind === "historical" ? selection.view ?? "tools" : "live"}` : null,
    itemCount,
    contentVersion: selection?.kind === "historical" ? props.hydratedMessageIds.size : undefined
  });

  useEffect(() => {
    if (!selection) {
      return undefined;
    }

    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        props.onClose();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [props.onClose, selection]);

  if (!selection) {
    return null;
  }

  const { headerElement, bodyElement } = getToolInspectorContent({ ...props, selection });

  const panelContent = (
    <>
      {headerElement}
      <div className="tool-inspector-body" ref={bodyRef} onScroll={handleScroll}>
        {bodyElement}
      </div>
    </>
  );

  if (variant === "docked") {
    return (
      <aside className="tool-inspector-panel tool-inspector-panel-docked" aria-label="Activity panel">
        {panelContent}
      </aside>
    );
  }

  return (
    <div className="tool-inspector-layer" role="presentation">
      <button
        type="button"
        className="tool-inspector-backdrop"
        aria-label="Close activity panel"
        onClick={props.onClose}
      />
      <aside className="tool-inspector-panel" aria-label="Activity panel">
        {panelContent}
      </aside>
    </div>
  );
}

import { useEffect, useState, type RefObject } from "react";
import type { LiveEvent } from "../../../lib/types";
import { InlineProgressBar } from "../../../components/InlineProgressBar";
import { badgeClass, formatRelative } from "../../../lib/utils";
import { copyTextToClipboard } from "../../environment/overview/environmentOverviewUtils";
import {
  eventTitle,
  formatCommandDuration,
  readBoolean,
  readNumber,
  readString
} from "./taskDetailUtils";
import { getNetworkRequestReplayText, serializeTaskEventsForClipboard } from "./taskDetailEventHelpers";

interface TaskDetailEventsPaneProps {
  events: LiveEvent[];
  isBootstrapping: boolean;
  isPageLoading: boolean;
  eventsFeedRef: RefObject<HTMLDivElement>;
  onScroll: () => void;
}

function omitPayloadKeys(payload: Record<string, unknown>, keys: string[]): Record<string, unknown> {
  const nextPayload = { ...payload };
  for (const key of keys) {
    delete nextPayload[key];
  }
  return nextPayload;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function NetworkRequestReplayButton(props: { event: LiveEvent }) {
  const [copyState, setCopyState] = useState<"idle" | "copied" | "error">("idle");
  const replayText = getNetworkRequestReplayText(props.event);

  useEffect(() => {
    if (copyState === "idle") {
      return undefined;
    }

    const timeout = window.setTimeout(() => {
      setCopyState("idle");
    }, 1800);

    return () => window.clearTimeout(timeout);
  }, [copyState]);

  if (!replayText) {
    return null;
  }
  const replayCommand = replayText;

  const copyTitle = copyState === "copied"
    ? "Copied request"
    : copyState === "error"
      ? "Copy failed"
      : "Copy request";

  async function handleCopyRequest(): Promise<void> {
    const copied = await copyTextToClipboard(replayCommand);
    setCopyState(copied ? "copied" : "error");
  }

  return (
    <button
      type="button"
      className={`btn ghost event-copy-request-btn ${copyState === "copied" ? "active" : ""}`}
      onClick={() => void handleCopyRequest()}
      title={copyTitle}
      aria-label={copyTitle}
    >
      {copyState === "copied" ? "Copied" : "Copy request"}
    </button>
  );
}

function TaskDetailEventRow(props: { event: LiveEvent }) {
  const evt = props.event;
  const showRoutingDetails = evt.type === "model_routed";
  const networkRequest = isRecord(evt.payload.networkRequest) ? evt.payload.networkRequest : null;
  const request = networkRequest && isRecord(networkRequest.request) ? networkRequest.request : null;
  const command = readString(evt.payload.command);
  const toolName = readString(evt.payload.tool);
  const statusValue = readString(evt.payload.status);
  const messageText = readString(evt.payload.message);
  const stage = readString(evt.payload.stage);
  const phase = readString(evt.payload.phase);
  const step = readNumber(evt.payload.step);
  const exitCode = readNumber(evt.payload.exitCode);
  const durationMs = readNumber(evt.payload.durationMs);
  const timedOut = readBoolean(evt.payload.timedOut) ?? false;
  const interrupted = readBoolean(evt.payload.interrupted) ?? false;
  const requestedModel = readString(evt.payload.requestedModel);
  const resolvedModel = readString(evt.payload.resolvedModel);
  const routingModel = readString(evt.payload.routingModel);
  const reasoningEffort = readString(evt.payload.reasoningEffort);
  const reasoningScore = readNumber(evt.payload.reasoningScore);
  const routingReason = readString(evt.payload.reason);
  const cached = readBoolean(evt.payload.cached) ?? false;
  const usedFallback = readBoolean(evt.payload.usedFallback) ?? false;
  const requestMethod = readString(request?.method);
  const requestUrl = readString(request?.url);
  const payloadDetails = omitPayloadKeys(evt.payload, [
    "command",
    "tool",
    "status",
    "message",
    "stage",
    "phase",
    "step",
    "exitCode",
    "durationMs",
    "timedOut",
    "interrupted",
    ...(showRoutingDetails
      ? [
          "requestedModel",
          "resolvedModel",
          "routingModel",
          "reasoningEffort",
          "reasoningScore",
          "reason",
          "cached",
          "usedFallback"
        ]
      : [])
  ]);

  return (
    <div className="event-row" data-event-id={evt.id}>
      <header>
        <strong>{eventTitle(evt.type)}</strong>
        <span>{formatRelative(evt.createdAt)}</span>
      </header>
      <div className="event-meta-row">
        <span className={`event-chip ${evt.type === "command_start" ? "running" : ""}`}>
          {evt.type}
        </span>
        {toolName ? <span className="event-chip">{toolName}</span> : null}
        {stage ? <span className="event-chip">{stage}</span> : null}
        {phase ? (
          <span className={`event-chip ${phase === "error" ? "danger" : phase === "success" ? "good" : ""}`}>
            {phase}
          </span>
        ) : null}
        {statusValue ? <span className={badgeClass(statusValue)}>{statusValue}</span> : null}
        {showRoutingDetails && requestedModel ? <span className="event-chip">{requestedModel}</span> : null}
        {showRoutingDetails && resolvedModel ? <span className="event-chip good">{resolvedModel}</span> : null}
        {showRoutingDetails && reasoningEffort ? <span className="event-chip">{reasoningEffort}</span> : null}
        {showRoutingDetails && reasoningScore !== null ? <span className="event-chip">score {reasoningScore}</span> : null}
        {showRoutingDetails && cached ? <span className="event-chip">cached</span> : null}
        {showRoutingDetails && usedFallback ? <span className="event-chip danger">fallback</span> : null}
        {step !== null ? <span className="event-chip">step {step}</span> : null}
        {exitCode !== null ? (
          <span className={`event-chip ${exitCode === 0 ? "good" : "danger"}`}>exit {exitCode}</span>
        ) : null}
        {timedOut ? <span className="event-chip danger">timed out</span> : null}
        {interrupted ? <span className="event-chip danger">interrupted</span> : null}
        {durationMs !== null ? <span className="event-chip">{formatCommandDuration(durationMs)}</span> : null}
      </div>
      {command ? <pre className="event-command-block">{command}</pre> : null}
      {evt.type === "model_routed" && requestedModel && resolvedModel ? (
        <p className="muted-text" style={{ margin: 0 }}>
          {requestedModel} → {resolvedModel}
          {routingModel ? ` via ${routingModel}` : ""}
        </p>
      ) : null}
      {showRoutingDetails && routingReason ? (
        <p className={evt.type === "model_routed" ? "muted-text" : "event-error-text"} style={{ margin: 0 }}>
          {routingReason}
        </p>
      ) : null}
      {messageText && evt.type === "error" ? <p className="event-error-text">{messageText}</p> : null}
      {messageText && evt.type === "log" ? <p style={{ margin: 0 }}>{messageText}</p> : null}
      {messageText && evt.type !== "model_routed" && evt.type !== "error" && evt.type !== "log" ? (
        <p className="muted-text" style={{ margin: 0 }}>{messageText}</p>
      ) : null}
      {requestMethod || requestUrl ? (
        <div className="event-request-row">
          <div className="event-request-summary">
            {requestMethod ? <span className="event-chip">{requestMethod}</span> : null}
            {requestUrl ? <code>{requestUrl}</code> : null}
          </div>
          <NetworkRequestReplayButton event={evt} />
        </div>
      ) : null}
      {Object.keys(payloadDetails).length > 0 ? (
        <details className="event-payload-details">
          <summary>Payload</summary>
          <pre>{JSON.stringify(payloadDetails, null, 2)}</pre>
        </details>
      ) : null}
    </div>
  );
}

export function TaskDetailEventsPane(props: TaskDetailEventsPaneProps) {
  const [copyState, setCopyState] = useState<"idle" | "copied" | "error">("idle");

  useEffect(() => {
    if (copyState === "idle") {
      return undefined;
    }

    const timeout = window.setTimeout(() => {
      setCopyState("idle");
    }, 1800);

    return () => window.clearTimeout(timeout);
  }, [copyState]);

  async function handleCopyEvents(): Promise<void> {
    const copied = await copyTextToClipboard(serializeTaskEventsForClipboard(props.events));
    setCopyState(copied ? "copied" : "error");
  }

  const copyTitle = copyState === "copied"
    ? "Copied"
    : copyState === "error"
      ? "Copy failed"
      : "Copy events";

  return (
    <div className="page-content task-tab-pane events-pane" ref={props.eventsFeedRef} onScroll={props.onScroll}>
      <div className="events-pane-toolbar">
        <button
          type="button"
          className={`btn ghost icon-btn events-copy-btn ${copyState === "copied" ? "active" : ""}`}
          onClick={() => void handleCopyEvents()}
          disabled={props.events.length === 0}
          title={copyTitle}
          aria-label={copyTitle}
        >
          {copyState === "copied" ? "✓" : "⧉"}
        </button>
      </div>
      <div className="event-list">
        {props.isBootstrapping ? <InlineProgressBar pin="top" /> : null}
        {props.events.map((event) => <TaskDetailEventRow key={event.id} event={event} />)}
        {props.isPageLoading ? <InlineProgressBar pin="top" /> : null}
        {props.events.length === 0 && !props.isBootstrapping ? <p className="empty-hint">No events captured.</p> : null}
      </div>
    </div>
  );
}

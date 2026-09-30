import { useMemo, useState } from "react";
import { Download, RefreshCw } from "lucide-react";
import type { ApiClient } from "../../../lib/api";
import type { LiveEvent } from "../../../lib/types";
import { readString } from "./taskDetailUtils";

type DebugSubTab = "network" | "message-items";

interface TaskDebugMessageItemsResponse {
  taskId: string;
  items: unknown[];
}

interface NetworkDebugEntry {
  id: string;
  createdAt: string;
  endpoint: string;
  model: string;
  phase: string;
  attempt: number | null;
  request: Record<string, unknown> | null;
  responseStream: Record<string, unknown> | null;
}

interface TaskDetailDebugPaneProps {
  api: ApiClient;
  taskId: string;
  events: LiveEvent[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function downloadJsonFile(filename: string, payload: unknown): void {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json;charset=utf-8" });
  const objectUrl = window.URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = filename;
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => {
    window.URL.revokeObjectURL(objectUrl);
  }, 0);
}

function buildNetworkDebugEntries(events: LiveEvent[]): NetworkDebugEntry[] {
  const entries: NetworkDebugEntry[] = [];
  const pendingEntryIndexByKey = new Map<string, number>();

  for (const event of events) {
    const networkRequest = isRecord(event.payload.networkRequest) ? event.payload.networkRequest : null;
    if (!networkRequest || networkRequest.service !== "openai_responses") {
      continue;
    }

    const request = isRecord(networkRequest.request) ? networkRequest.request : null;
    const responseStream = isRecord(networkRequest.responseStream) ? networkRequest.responseStream : null;
    if (!request && !responseStream) {
      continue;
    }

    const endpoint = readString(networkRequest.endpoint) ?? "responses.create";
    const model = readString(networkRequest.model) ?? "unknown";
    const attempt = typeof networkRequest.attempt === "number" ? networkRequest.attempt : null;
    const key = [
      readString(networkRequest.service) ?? "openai_responses",
      endpoint,
      model,
      readString(networkRequest.baseUrl) ?? "",
      attempt ?? "unknown"
    ].join(":");
    const phase = readString(networkRequest.phase) ?? "unknown";

    if (request) {
      const entryIndex = entries.length;
      entries.push({
        id: event.id,
        createdAt: event.createdAt,
        endpoint,
        model,
        phase,
        attempt,
        request,
        responseStream: null
      });
      pendingEntryIndexByKey.set(key, entryIndex);
      continue;
    }

    const pendingIndex = pendingEntryIndexByKey.get(key);
    if (pendingIndex !== undefined) {
      entries[pendingIndex] = {
        ...entries[pendingIndex],
        phase,
        responseStream
      };
      pendingEntryIndexByKey.delete(key);
      continue;
    }

    entries.push({
      id: event.id,
      createdAt: event.createdAt,
      endpoint,
      model,
      phase,
      attempt,
      request: null,
      responseStream
    });
  }

  return entries;
}

function NetworkDebugPanel(props: { events: LiveEvent[] }) {
  const entries = useMemo(() => buildNetworkDebugEntries(props.events), [props.events]);

  return (
    <div className="debug-network-list">
      {entries.map((entry, index) => (
        <div className="debug-network-row" key={entry.id}>
          <div className="debug-network-row-main">
            <strong>{entry.endpoint}</strong>
            <span className="muted-text">{entry.model}</span>
            <span className={`event-chip ${entry.phase === "error" ? "danger" : entry.phase === "success" ? "good" : ""}`}>
              {entry.phase}
            </span>
            {entry.attempt !== null ? <span className="event-chip">attempt {entry.attempt}</span> : null}
          </div>
          <div className="debug-network-actions">
            <button
              type="button"
              className="btn ghost"
              disabled={!entry.request}
              onClick={() => downloadJsonFile(`task-network-request-${index + 1}.json`, entry.request)}
            >
              <Download size={14} />
              Request
            </button>
            <button
              type="button"
              className="btn ghost"
              disabled={!entry.responseStream}
              onClick={() => downloadJsonFile(`task-network-response-stream-${index + 1}.json`, entry.responseStream)}
            >
              <Download size={14} />
              Stream
            </button>
          </div>
        </div>
      ))}
      {entries.length === 0 ? <p className="empty-hint">No debug network payloads captured.</p> : null}
    </div>
  );
}

function MessageItemsPanel(props: { api: ApiClient; taskId: string }) {
  const [items, setItems] = useState<unknown[] | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadItems(): Promise<void> {
    setIsLoading(true);
    setError(null);
    try {
      const response = await props.api.get<TaskDebugMessageItemsResponse>(`/api/tasks/${props.taskId}/debug/message-items`);
      setItems(response.items);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="debug-message-items-panel">
      <div className="debug-pane-toolbar">
        <button type="button" className="btn ghost" onClick={() => void loadItems()} disabled={isLoading}>
          <RefreshCw size={14} className={isLoading ? "spin-icon" : ""} />
          {items ? "Refresh" : "Fetch"}
        </button>
        <button
          type="button"
          className="btn ghost"
          disabled={!items}
          onClick={() => downloadJsonFile(`task-message-items-${props.taskId}.json`, items ?? [])}
        >
          <Download size={14} />
          JSON
        </button>
      </div>
      {error ? <p className="error-text">{error}</p> : null}
      {items ? (
        <pre className="debug-json-preview">{JSON.stringify(items, null, 2)}</pre>
      ) : (
        <p className="empty-hint">Fetch message items from the database when needed.</p>
      )}
    </div>
  );
}

export function TaskDetailDebugPane(props: TaskDetailDebugPaneProps) {
  const [activeSubTab, setActiveSubTab] = useState<DebugSubTab>("network");

  return (
    <div className="page-content task-tab-pane debug-pane">
      <div className="debug-pane-tabs">
        <button
          type="button"
          className={activeSubTab === "network" ? "active" : ""}
          onClick={() => setActiveSubTab("network")}
        >
          Network
        </button>
        <button
          type="button"
          className={activeSubTab === "message-items" ? "active" : ""}
          onClick={() => setActiveSubTab("message-items")}
        >
          Message items
        </button>
      </div>
      {activeSubTab === "network" ? <NetworkDebugPanel events={props.events} /> : null}
      {activeSubTab === "message-items" ? <MessageItemsPanel api={props.api} taskId={props.taskId} /> : null}
    </div>
  );
}

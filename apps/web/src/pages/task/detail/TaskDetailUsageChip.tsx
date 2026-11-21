import { useEffect, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import { Minimize2 } from "lucide-react";
import { calculateContextUsagePercent } from "@meowbert/shared/context-usage";
import type { TaskDetail } from "../../../lib/types";
import { formatRelative } from "../../../lib/utils";
import { formatTokenCount } from "./taskDetailUtils";
import { TaskUsageModal } from "./TaskUsageModal";

export interface UsageSummary {
  usageTokens: number;
  usageMaxTokens: number;
  usagePercent: number;
  cacheHitPercent: number | null;
  cachedTokens: number | null;
  promptRevision: string | null;
  prefixHash: string | null;
}

export function getUsageSummary(latestUsagePayload: TaskDetail["latest_context_usage"]): UsageSummary | null {
  const usageTokens =
    latestUsagePayload && typeof latestUsagePayload.usedTokens === "number"
      ? latestUsagePayload.usedTokens
      : null;
  const usageMaxTokens =
    latestUsagePayload && typeof latestUsagePayload.maxContextTokens === "number"
      ? latestUsagePayload.maxContextTokens
      : null;

  if (usageTokens === null || usageMaxTokens === null || usageMaxTokens <= 0) {
    return null;
  }

  const usagePercent = calculateContextUsagePercent(usageTokens, usageMaxTokens);
  const cachedTokens =
    latestUsagePayload && typeof latestUsagePayload.cachedTokens === "number"
      ? latestUsagePayload.cachedTokens
      : null;
  const cacheHitRatio =
    latestUsagePayload && typeof latestUsagePayload.cacheHitRatio === "number"
      ? latestUsagePayload.cacheHitRatio
      : cachedTokens !== null && usageTokens > 0
        ? Math.min(1, Math.max(0, cachedTokens / usageTokens))
        : null;

  return {
    usageTokens,
    usageMaxTokens,
    usagePercent,
    cacheHitPercent: cacheHitRatio !== null ? Math.round(cacheHitRatio * 100) : null,
    cachedTokens,
    promptRevision:
      latestUsagePayload && typeof latestUsagePayload.promptRevision === "string"
        ? latestUsagePayload.promptRevision
        : null,
    prefixHash:
      latestUsagePayload && typeof latestUsagePayload.prefixHash === "string"
        ? latestUsagePayload.prefixHash
        : null
  };
}

function useDismissOnOutsideOrEscape(open: boolean, onDismiss: () => void, ref: RefObject<HTMLDivElement>): void {
  useEffect(() => {
    if (!open) return;

    function handlePointerDown(event: PointerEvent): void {
      const target = event.target as Node | null;
      if (target && !ref.current?.contains(target)) {
        onDismiss();
      }
    }

    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        onDismiss();
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open, onDismiss, ref]);
}

function buildUsageTitle(usage: UsageSummary, idleCompactionLabel: string | null): string {
  return [
    `Context ${formatTokenCount(usage.usageTokens)} / ${formatTokenCount(usage.usageMaxTokens)} (${usage.usagePercent}%)`,
    usage.cacheHitPercent !== null && usage.cachedTokens !== null
      ? `Cache hit ${usage.cacheHitPercent}% (${formatTokenCount(usage.cachedTokens)} cached)`
      : null,
    usage.promptRevision ? `Revision ${usage.promptRevision}` : null,
    usage.prefixHash ? `Prefix ${usage.prefixHash}` : null,
    idleCompactionLabel
  ]
    .filter((entry): entry is string => typeof entry === "string" && entry.length > 0)
    .join(" • ");
}

export function TaskDetailUsageChip(props: {
  taskId: string;
  usage: UsageSummary | null;
  lastIdleCompactionAt: string | null;
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
  align?: "left" | "right";
}) {
  const popoverRef = useRef<HTMLDivElement>(null);
  const [usageModalOpen, setUsageModalOpen] = useState(false);
  const isExpanded = props.usage !== null && props.expanded;
  useDismissOnOutsideOrEscape(isExpanded, () => props.onExpandedChange(false), popoverRef);

  if (props.usage === null) {
    return (
      <span
        className="context-usage-pill unavailable"
        title="Context usage will appear after the provider reports input-token usage."
        aria-label="Context usage unavailable"
      >
        Context —
      </span>
    );
  }

  const usage = props.usage;
  // The usage shown is from before the compaction; the next turn starts from the notes.
  const idleCompactionLabel = props.lastIdleCompactionAt
    ? `Compacted while idle ${formatRelative(props.lastIdleCompactionAt)}`
    : null;
  const isWarning = usage.usagePercent >= 80;
  const isCritical = usage.usagePercent >= 95;
  const popoverClassName = props.align === "right"
    ? "context-usage-chip task-detail-usage-popover align-right"
    : "context-usage-chip task-detail-usage-popover";

  return (
    <div className="task-detail-usage-container" ref={popoverRef}>
      <button
        type="button"
        className={`context-usage-pill ${isCritical ? "critical" : isWarning ? "warning" : ""} ${isExpanded ? "expanded" : ""}`}
        onClick={() => props.onExpandedChange(!isExpanded)}
        title={buildUsageTitle(usage, idleCompactionLabel)}
        aria-expanded={isExpanded}
      >
        <span className="context-usage-pill-meter" aria-hidden="true">
          <span
            className="context-usage-pill-fill"
            style={{ width: `${Math.min(100, Math.max(0, usage.usagePercent))}%` }}
          />
        </span>
        <span className="context-usage-pill-text">Context {usage.usagePercent}%</span>
        {idleCompactionLabel ? <Minimize2 size={11} className="context-usage-pill-idle" aria-label={idleCompactionLabel} /> : null}
      </button>

      {isExpanded ? (
        <div className={popoverClassName} role="dialog" aria-label="Context usage details">
          <div className="context-usage-label">
            Context {formatTokenCount(usage.usageTokens)} / {formatTokenCount(usage.usageMaxTokens)} ({usage.usagePercent}%)
          </div>
          {usage.cacheHitPercent !== null && usage.cachedTokens !== null ? (
            <div className="muted-text" style={{ fontSize: "0.75rem" }}>
              Cache hit {usage.cacheHitPercent}% ({formatTokenCount(usage.cachedTokens)} cached)
              {usage.promptRevision ? ` · ${usage.promptRevision}` : ""}
              {usage.prefixHash ? ` · ${usage.prefixHash}` : ""}
            </div>
          ) : null}
          {idleCompactionLabel ? (
            <div className="muted-text" style={{ fontSize: "0.75rem" }}>{idleCompactionLabel}</div>
          ) : null}
          <div className="context-usage-meter">
            <span
              style={{
                width: `${Math.min(100, Math.max(0, usage.usagePercent))}%`,
                background: isCritical
                  ? "var(--danger)"
                  : isWarning
                    ? "var(--warning)"
                    : "var(--brand)"
              }}
            />
          </div>
          <button
            type="button"
            className="task-detail-usage-popover-link"
            onClick={() => {
              props.onExpandedChange(false);
              setUsageModalOpen(true);
            }}
          >
            View usage for this task
          </button>
        </div>
      ) : null}
      {usageModalOpen
        ? createPortal(<TaskUsageModal taskId={props.taskId} onClose={() => setUsageModalOpen(false)} />, document.body)
        : null}
    </div>
  );
}

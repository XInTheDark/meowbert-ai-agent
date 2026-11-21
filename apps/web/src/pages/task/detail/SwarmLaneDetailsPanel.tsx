import { useState } from "react";
import type { AgentSwarmLaneView } from "@meowbert/shared/agent-swarm-view";
import { TaskStatusBadge } from "../../../components/tasks/TaskStatusBadge";
import type { TaskDetail } from "../../../lib/types";
import { formatDateTime, formatRelative } from "../../../lib/utils";
import { formatTokenCount } from "./taskDetailUtils";
import { getUsageSummary, TaskDetailUsageChip } from "./TaskDetailUsageChip";

interface SwarmLaneDetailsPanelProps {
  lane: AgentSwarmLaneView;
  taskDetail: TaskDetail | null;
}

const LANE_KIND_LABELS: Record<AgentSwarmLaneView["kind"], string> = {
  split: "Split lane",
  diverge: "Diverge lane",
  check: "Check lane"
};

function formatDuration(startedAt: string | null, endedAt: string | null): string | null {
  if (!startedAt) return null;
  const startMs = new Date(startedAt).getTime();
  const endMs = endedAt ? new Date(endedAt).getTime() : Date.now();
  if (Number.isNaN(startMs) || Number.isNaN(endMs) || endMs < startMs) return null;
  const seconds = Math.round((endMs - startMs) / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remSeconds = seconds % 60;
  if (minutes < 60) return `${minutes}m ${remSeconds}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

export function SwarmLaneDetailsPanel(props: SwarmLaneDetailsPanelProps) {
  const { lane, taskDetail } = props;
  const [contextExpanded, setContextExpanded] = useState(false);
  const usage = getUsageSummary(taskDetail?.latest_context_usage ?? null);
  const duration = formatDuration(lane.startedAt, lane.endedAt);
  const kindText = lane.kind === "check"
    ? `${LANE_KIND_LABELS[lane.kind]} (${lane.reviewEffort === "thorough" ? "Thorough" : "Standard"} review)`
    : LANE_KIND_LABELS[lane.kind];

  return (
    <div className="swarm-lane-panel swarm-lane-details-panel">
      <section className="swarm-lane-details-section">
        <div className="swarm-lane-details-badges">
          <TaskStatusBadge status={lane.status === "waiting" ? "waiting_for_lanes" : lane.status} />
          <TaskDetailUsageChip
            taskId={lane.id}
            usage={usage}
            lastIdleCompactionAt={taskDetail?.last_idle_compaction_at ?? null}
            expanded={contextExpanded}
            onExpandedChange={setContextExpanded}
            align="right"
          />
        </div>

        <dl className="swarm-lane-details-grid">
          <div><dt>Type</dt><dd>{kindText}</dd></div>
          <div><dt>Model</dt><dd>{lane.model || "Inherited"}</dd></div>
          <div><dt>Steps</dt><dd>{lane.steps}</dd></div>
          <div><dt>Tokens</dt><dd>{lane.spentTokens > 0 ? formatTokenCount(lane.spentTokens) : "—"}</dd></div>
          <div><dt>Depth</dt><dd>Level {lane.depth}</dd></div>
          {duration ? <div><dt>{lane.endedAt ? "Duration" : "Elapsed"}</dt><dd>{duration}</dd></div> : null}
          <div>
            <dt>Created</dt>
            <dd title={formatDateTime(lane.createdAt)}>{formatRelative(lane.createdAt)}</dd>
          </div>
          {lane.endedAt ? (
            <div>
              <dt>Finished</dt>
              <dd title={formatDateTime(lane.endedAt)}>{formatRelative(lane.endedAt)}</dd>
            </div>
          ) : null}
          {lane.kind === "check" ? <div><dt>Findings</dt><dd>{lane.checkFindings}</dd></div> : null}
          {lane.resumable ? <div><dt>State</dt><dd>Dormant (resumable)</dd></div> : null}
        </dl>
      </section>

      {lane.direction ? (
        <section className="swarm-lane-details-section">
          <h4>Direction</h4>
          <div className="swarm-lane-details-text">{lane.direction}</div>
        </section>
      ) : null}

      {lane.summary ? (
        <section className="swarm-lane-details-section">
          <h4>Submitted summary</h4>
          <div className="swarm-lane-details-text">{lane.summary}</div>
        </section>
      ) : null}
    </div>
  );
}

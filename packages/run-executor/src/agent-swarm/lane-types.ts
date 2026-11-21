import type { ReviewEffort, ReviewFinding } from "@meowbert/shared";

export type SwarmLaneKind = "split" | "diverge" | "check";
export type SwarmLaneStatus = "queued" | "running" | "waiting" | "done" | "failed" | "stopped" | "expired";

// A lane that has not finished: its parent's barrier waits for it.
export const ACTIVE_LANE_STATUSES: readonly SwarmLaneStatus[] = ["queued", "running", "waiting"];
export const TERMINAL_LANE_STATUSES: readonly SwarmLaneStatus[] = ["done", "failed", "stopped"];

export interface SwarmLaneFile {
  path: string;
  bytes: number | null;
}

export interface SwarmLaneResult {
  summary: string;
  decisions: Array<{ choice: string; reason: string; would_change_if: string }> | null;
  findings: ReviewFinding[] | null;
  files: SwarmLaneFile[];
}

export interface SwarmLaneRow {
  task_id: string;
  swarm_task_id: string;
  parent_task_id: string;
  depth: number;
  kind: SwarmLaneKind;
  title: string;
  direction: string | null;
  // Read from the Check lane's seed metadata; older lanes default to standard.
  review_effort?: ReviewEffort | null;
  status: SwarmLaneStatus;
  fork_seed_id: string | null;
  weight: string;
  share_tokens: string | null;
  spent_tokens: string;
  steps: number;
  note_cursor: string;
  result_json: SwarmLaneResult | null;
  merged_at: string | null;
  created_at: string;
  started_at: string | null;
  ended_at: string | null;
}

// Why a swarm run parked instead of finishing.
export type SwarmParkReason = "lanes" | "check" | "resume";

export type SwarmNoteKind = "shared" | "auto";
export const SHARE_SCOPES = ["siblings", "parent", "all"] as const;
export type ShareScope = (typeof SHARE_SCOPES)[number];
export const SHARE_NOTIFY_MODES = ["none", "inbox", "wake"] as const;
export type ShareNotifyMode = (typeof SHARE_NOTIFY_MODES)[number];

export interface SwarmNote {
  seq: string;
  kind: SwarmNoteKind;
  content: string;
  author_title: string;
}

export interface ParentShareNote {
  seq: string;
  author_task_id: string;
  author_title: string;
  content: string;
  notify_parent: Exclude<ShareNotifyMode, "none">;
}

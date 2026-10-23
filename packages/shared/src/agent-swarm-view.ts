// What the task page shows of an Agent Swarm: its lanes as a tree, their latest notes, and the
// swarm's totals. Lanes are tasks too, so each one opens with the normal task view.

export type AgentSwarmLaneKind = "split" | "diverge" | "check";
export type AgentSwarmLaneStatus = "queued" | "running" | "waiting" | "done" | "failed" | "stopped" | "expired";

export interface AgentSwarmLaneView {
  id: string;
  parentId: string;
  // Lanes forked by one split, diverge or check call share a group.
  groupId: string | null;
  depth: number;
  kind: AgentSwarmLaneKind;
  title: string;
  direction: string | null;
  status: AgentSwarmLaneStatus;
  model: string | null;
  steps: number;
  spentTokens: number;
  checkFindings: number;
  summary: string | null;
  latestNote: string | null;
  // Submitted, merged and still within the swarm's dormant turns, so its parent can resume it.
  resumable: boolean;
  createdAt: string;
  startedAt: string | null;
  endedAt: string | null;
}

export interface AgentSwarmView {
  budgetsEnabled: boolean;
  tokenBudget: number | null;
  spentTokens: number;
  deadlineAt: string | null;
  dormantLaneTurns: number;
  lanes: AgentSwarmLaneView[];
}

export interface AgentSwarmNoteView {
  seq: string;
  laneId: string;
  laneTitle: string;
  kind: "shared" | "auto";
  content: string;
  createdAt: string;
}

// Admin outcome view: how leaders on each model use lanes.
export interface AgentSwarmOutcomeRow {
  leaderModel: string;
  swarmTurns: number;
  lanes: number;
  lanesPerTurn: number;
  splitLanes: number;
  divergeLanes: number;
  checkLanes: number;
  stoppedRate: number;
  failedRate: number;
  checkFindingsPerTurn: number;
}

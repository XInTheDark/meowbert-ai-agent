import type {
  SwarmChannelMessage,
  AgentSwarmWorkflowOverview,
  TaskWorkflowOverview
} from "../../../lib/types";

export type AgentSwarmWorkerItem =
  AgentSwarmWorkflowOverview["agentSwarm"]["workers"][number];

export type AgentSwarmChannelItem =
  AgentSwarmWorkflowOverview["agentSwarm"]["channels"][number];

export type LongHorizonReviewItem =
  Extract<TaskWorkflowOverview, { type: "long_horizon" }>["longHorizon"]["reviews"][number];

export type LongHorizonReviewerItem =
  Extract<TaskWorkflowOverview, { type: "long_horizon" }>["longHorizon"]["reviewers"][number];

export type TaskWorkflowSidebarPanel =
  | {
    kind: "overview";
  }
  | {
    kind: "worker";
    workerTaskId: string;
    slotIndex: number;
    title: string | null;
    status: string;
    paused?: boolean;
    pauseReason?: string | null;
    updatedAt?: string;
  }
  | {
    kind: "channel";
    channelId: string;
    title: string | null;
    channelKind: "global" | "direct" | "group";
    memberCount: number;
    latestMessageNo?: number | null;
  }
  | {
    kind: "plan";
  }
  | {
    kind: "submission";
  }
  | {
    kind: "review";
    reviewId: string;
    reviewerSlot: number | null;
    approved: boolean;
    review: string;
    createdAt: string;
  }
  | {
    kind: "reviewer";
    reviewerTaskId: string;
    slotIndex: number;
    title: string | null;
    status: string;
    updatedAt: string;
  };

export function formatSwarmSenderLabel(message: SwarmChannelMessage): string {
  if (message.sender_task_id === null && message.sender_role === null) {
    return "System";
  }

  if (message.sender_role === "leader") {
    return "Leader";
  }

  if (message.sender_role === "worker" && typeof message.sender_slot_index === "number") {
    return `Worker ${message.sender_slot_index + 1}`;
  }

  if (message.sender_role === "reviewer" && typeof message.sender_slot_index === "number") {
    return `Reviewer ${message.sender_slot_index + 1}`;
  }

  if (typeof message.sender_role === "string" && message.sender_role.trim().length > 0) {
    return message.sender_role;
  }

  return "Unknown";
}

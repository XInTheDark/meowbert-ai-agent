import type { LongHorizonWorkflowOverview } from "../../../lib/types";

export type LongHorizonReviewItem =
  LongHorizonWorkflowOverview["longHorizon"]["reviews"][number];

export type LongHorizonReviewerItem =
  LongHorizonWorkflowOverview["longHorizon"]["reviewers"][number];

export type TaskWorkflowSidebarPanel =
  | {
    kind: "overview";
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

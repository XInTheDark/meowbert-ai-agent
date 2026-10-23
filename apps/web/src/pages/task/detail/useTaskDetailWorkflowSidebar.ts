import { useCallback, useState } from "react";
import type {
  LongHorizonReviewItem,
  LongHorizonReviewerItem,
  TaskWorkflowSidebarPanel
} from "./taskWorkflowSidebarTypes";

export function useTaskDetailWorkflowSidebar() {
  const [workflowSidebarStack, setWorkflowSidebarStack] = useState<TaskWorkflowSidebarPanel[]>([]);

  const openOverview = useCallback(() => {
    setWorkflowSidebarStack([{ kind: "overview" }]);
  }, []);

  const openPlan = useCallback(() => {
    setWorkflowSidebarStack((current) => [
      ...(current.length === 0 ? [{ kind: "overview" as const }] : current),
      { kind: "plan" }
    ]);
  }, []);

  const openSubmission = useCallback(() => {
    setWorkflowSidebarStack((current) => [
      ...(current.length === 0 ? [{ kind: "overview" as const }] : current),
      { kind: "submission" }
    ]);
  }, []);

  const openReview = useCallback((review: LongHorizonReviewItem) => {
    setWorkflowSidebarStack((current) => [
      ...(current.length === 0 ? [{ kind: "overview" as const }] : current),
      {
        kind: "review",
        reviewId: review.id,
        reviewerSlot: review.reviewer_slot_index,
        approved: review.approved,
        review: review.review,
        createdAt: review.created_at
      }
    ]);
  }, []);

  const openReviewer = useCallback((reviewer: LongHorizonReviewerItem) => {
    setWorkflowSidebarStack((current) => [
      ...(current.length === 0 ? [{ kind: "overview" as const }] : current),
      {
        kind: "reviewer",
        reviewerTaskId: reviewer.task_id,
        slotIndex: reviewer.slot_index,
        title: reviewer.title,
        status: reviewer.status,
        updatedAt: reviewer.updated_at
      }
    ]);
  }, []);

  const popPanel = useCallback(() => {
    setWorkflowSidebarStack((current) => (current.length > 1 ? current.slice(0, -1) : []));
  }, []);

  const closeSidebar = useCallback(() => {
    setWorkflowSidebarStack([]);
  }, []);

  const activePanel: TaskWorkflowSidebarPanel | null =
    workflowSidebarStack.length > 0 ? workflowSidebarStack[workflowSidebarStack.length - 1] : null;

  return {
    workflowSidebarStack,
    setWorkflowSidebarStack,
    openOverview,
    openPlan,
    openSubmission,
    openReview,
    openReviewer,
    popPanel,
    closeSidebar,
    isWorkflowSidebarOpen: workflowSidebarStack.length > 0,
    activePanel
  };
}

export type TaskDetailWorkflowSidebarController = ReturnType<typeof useTaskDetailWorkflowSidebar>;

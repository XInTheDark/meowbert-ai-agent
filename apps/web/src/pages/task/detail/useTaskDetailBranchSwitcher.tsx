import { useCallback, useState, type Dispatch, type SetStateAction } from "react";
import type { ApiClient } from "../../../lib/api";
import type { TaskConversationBranchOption, TaskMessage } from "../../../lib/types";
import { switchTaskBranch } from "./taskDetailMutations";

function normalizeBranchNumber(value: number | string, fallback = 0): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  const parsed = Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

type UseTaskDetailBranchSwitcherOptions = {
  api: ApiClient;
  taskId: string;
  branchOptionsByMessageId: Record<string, TaskConversationBranchOption>;
  invalidateCurrentTaskCache: () => void;
  setActiveLeafMessageId: Dispatch<SetStateAction<string | null>>;
  setError: Dispatch<SetStateAction<string | null>>;
};

export function useTaskDetailBranchSwitcher(options: UseTaskDetailBranchSwitcherOptions) {
  const {
    api,
    taskId,
    branchOptionsByMessageId,
    invalidateCurrentTaskCache,
    setActiveLeafMessageId,
    setError
  } = options;
  const [branchSwitchingTo, setBranchSwitchingTo] = useState<string | null>(null);

  const switchBranch = useCallback(async (message: TaskMessage, direction: -1 | 1): Promise<void> => {
    if (!taskId) {
      return;
    }

    const branchOptions = branchOptionsByMessageId[message.id];
    const siblingCount = Math.max(branchOptions?.items.length ?? 0, branchOptions?.sibling_count ?? 0);
    if (!branchOptions || siblingCount < 2 || branchOptions.items.length < 2) {
      return;
    }

    const currentIndex = normalizeBranchNumber(branchOptions.current_index, -1);
    if (currentIndex < 0 || currentIndex >= branchOptions.items.length) {
      return;
    }

    const targetIndex = (currentIndex + direction + branchOptions.items.length) % branchOptions.items.length;
    const targetMessage = branchOptions.items[targetIndex];
    const targetLeafMessageId = targetMessage?.leaf_message_id ?? null;
    if (!targetLeafMessageId) {
      return;
    }

    setBranchSwitchingTo(targetLeafMessageId);
    try {
      await switchTaskBranch(api, taskId, targetLeafMessageId);
      invalidateCurrentTaskCache();
      setActiveLeafMessageId(targetLeafMessageId);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBranchSwitchingTo(null);
    }
  }, [api, branchOptionsByMessageId, invalidateCurrentTaskCache, setActiveLeafMessageId, setError, taskId]);

  const renderBranchSwitcher = useCallback((message: TaskMessage): JSX.Element | null => {
    const branchOptions = branchOptionsByMessageId[message.id];
    const siblingCount = Math.max(branchOptions?.items.length ?? 0, branchOptions?.sibling_count ?? 0);
    if (!branchOptions || siblingCount < 2 || branchOptions.items.length < 2) {
      return null;
    }

    const currentIndex = normalizeBranchNumber(branchOptions.current_index, -1);
    if (currentIndex < 0 || currentIndex >= branchOptions.items.length) {
      return null;
    }

    return (
      <div className="branch-switcher">
        <button
          type="button"
          className="branch-nav-btn"
          onClick={() => void switchBranch(message, -1)}
          disabled={branchSwitchingTo !== null}
          title="Previous branch"
        >
          &lt;
        </button>
        <span className="branch-index" title={`Branch ${currentIndex + 1} of ${siblingCount}`}>
          Branch {currentIndex + 1}/{siblingCount}
        </span>
        <button
          type="button"
          className="branch-nav-btn"
          onClick={() => void switchBranch(message, 1)}
          disabled={branchSwitchingTo !== null}
          title="Next branch"
        >
          &gt;
        </button>
      </div>
    );
  }, [branchOptionsByMessageId, branchSwitchingTo, switchBranch]);

  return { renderBranchSwitcher };
}

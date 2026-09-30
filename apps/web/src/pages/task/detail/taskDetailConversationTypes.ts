import type { RefObject } from "react";
import type { ApiClient } from "../../../lib/api";
import type { TaskConversationBranchOption, TaskMessage } from "../../../lib/types";
import type { TaskDetailTab } from "./taskDetailConstants";
import type { ConversationTextAnchor } from "./taskDetailConversationScroll";

export interface UseTaskDetailConversationOptions {
  api: ApiClient;
  taskId: string;
  activeTab: TaskDetailTab;
  activeLeafMessageId?: string | null;
  refreshVersion?: number;
  isMobileViewport: boolean;
  isMobileInputExpanded: boolean;
}

export interface UseTaskDetailConversationResult {
  messages: TaskMessage[];
  outlineMessages: TaskMessage[];
  branchOptionsByMessageId: Record<string, TaskConversationBranchOption>;
  hydratedMessageIds: Set<string>;
  isConversationBootstrapping: boolean;
  isConversationPageLoading: boolean;
  conversationPageLoadDirection: "older" | "newer" | null;
  chatFeedRef: RefObject<HTMLDivElement>;
  messagePage: {
    start_index: number;
    end_index: number;
    total_items: number;
    has_older: boolean;
    has_newer: boolean;
  };
  topbarCollapsed: boolean;
  isNearBottom: boolean;
  expandTopbar: () => void;
  activateConversationTab: () => void;
  handleConversationScroll: () => void;
  handleConversationWheel: (event: React.WheelEvent<HTMLDivElement>) => void;
  handleToolGroupExpandRequested: (messageIds: string[]) => void;
  jumpToMessage: (messageId: string, textAnchor?: ConversationTextAnchor | null) => void;
  jumpToMessageIndex: (messageId: string, messageIndex: number) => Promise<void>;
}

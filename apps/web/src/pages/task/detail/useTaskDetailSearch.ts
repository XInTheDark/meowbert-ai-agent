import { useEffect, useState, type Dispatch, type SetStateAction } from "react";
import type { TaskConversationSearchMatch, TaskConversationSearchResult, TaskMessage } from "../../../lib/types";
import type { TaskDetailTab } from "./taskDetailConstants";

interface UseTaskDetailSearchInput {
  tab: TaskDetailTab;
  setTab: Dispatch<SetStateAction<TaskDetailTab>>;
  setActionsMenuOpen: Dispatch<SetStateAction<boolean>>;
  setMessageOutlineOpen: Dispatch<SetStateAction<boolean>>;
  jumpToMessage: (messageId: string) => void;
  jumpToMessageIndex: (messageId: string, messageIndex: number) => Promise<void>;
  messages: TaskMessage[];
}

export function useTaskDetailSearch(input: UseTaskDetailSearchInput) {
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [searchSelectedMessageId, setSearchSelectedMessageId] = useState<string | null>(null);
  const [searchSelectedMatch, setSearchSelectedMatch] = useState<TaskConversationSearchMatch | null>(null);
  const [searchForceExpandedMessageIds, setSearchForceExpandedMessageIds] = useState<Set<string>>(new Set());

  function handleOpenSearch(): void {
    // Disabled temporarily to prevent expensive server-side search scans.
  }

  useEffect(() => {
    // Global Cmd+F find disabled while search is temporarily deactivated.
  }, []);

  useEffect(() => {
    if (!isSearchOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key !== "f") return;
      event.preventDefault();
      const searchInput = document.querySelector<HTMLInputElement>(".task-search-panel-input");
      searchInput?.focus();
      searchInput?.select();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isSearchOpen]);

  function handleSearchResultSelected(result: TaskConversationSearchResult): void {
    setSearchSelectedMatch(result);
    void input.jumpToMessageIndex(result.messageId, result.messageIndex);
    setSearchForceExpandedMessageIds(new Set([result.messageId]));
  }

  function handleSearchSelectedResultChange(messageId: string | null): void {
    setSearchSelectedMessageId(messageId);
    if (!messageId) setSearchSelectedMatch(null);
  }

  function handleScrollToBottomRequested(): void {
    const lastMessage = input.messages[input.messages.length - 1];
    if (lastMessage) input.jumpToMessage(lastMessage.id);
  }

  return {
    isSearchOpen,
    setIsSearchOpen,
    searchSelectedMessageId,
    searchSelectedMatch,
    searchForceExpandedMessageIds,
    handleOpenSearch,
    handleSearchResultSelected,
    handleSearchSelectedResultChange,
    handleScrollToBottomRequested
  };
}

import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import type { TaskAttachment } from "../../../lib/types";
import {
  buildTaskConversationDraftKey,
  clearStoredTaskConversationDraft,
  getTaskConversationDraft,
  readTaskConversationDrafts,
  taskConversationDraftMatches,
  updateTaskConversationDraft,
  writeTaskConversationDrafts
} from "../../../task/taskConversationDrafts";

const TASK_CONVERSATION_DRAFT_PERSIST_DELAY_MS = 400;

type PendingConversationDraft = {
  key: string | null;
  message: string;
  attachments: TaskAttachment[];
};

type UseTaskConversationDraftPersistenceOptions = {
  taskId: string;
  followUp: string;
  setFollowUp: Dispatch<SetStateAction<string>>;
  attachments: TaskAttachment[];
  editingMessageId: string | null;
};

export function readCurrentTaskConversationDraft(taskId: string) {
  const key = taskId ? buildTaskConversationDraftKey(taskId) : null;
  return getTaskConversationDraft(readTaskConversationDrafts(), key);
}

export function useTaskConversationDraftPersistence(options: UseTaskConversationDraftPersistenceOptions) {
  const {
    taskId,
    followUp,
    setFollowUp,
    attachments,
    editingMessageId
  } = options;
  const [draftsByConversation, setDraftsByConversation] = useState(() => readTaskConversationDrafts());
  const [restoredConversationDraftKey, setRestoredConversationDraftKey] = useState<string | null>(null);
  const conversationDraftPersistTimerRef = useRef<number | null>(null);
  const pendingConversationDraftRef = useRef<PendingConversationDraft | null>(null);
  const taskConversationDraftKey = useMemo(() => (
    taskId ? buildTaskConversationDraftKey(taskId) : null
  ), [taskId]);
  const currentConversationDraft = useMemo(() => (
    getTaskConversationDraft(draftsByConversation, taskConversationDraftKey)
  ), [draftsByConversation, taskConversationDraftKey]);

  const persistConversationDraft = useCallback((input: PendingConversationDraft): void => {
    if (!input.key) {
      return;
    }

    const latest = readTaskConversationDrafts();
    const hasDraftContent = input.message.trim().length > 0 || input.attachments.length > 0;
    if (!hasDraftContent && !(input.key in latest)) {
      return;
    }

    if (taskConversationDraftMatches(getTaskConversationDraft(latest, input.key), input.message, input.attachments)) {
      return;
    }

    writeTaskConversationDrafts(updateTaskConversationDraft(latest, input.key, (draft) => ({
      ...draft,
      message: input.message,
      attachments: input.attachments
    })));
  }, []);

  const cancelPendingConversationDraftPersist = useCallback((): void => {
    if (conversationDraftPersistTimerRef.current !== null) {
      window.clearTimeout(conversationDraftPersistTimerRef.current);
      conversationDraftPersistTimerRef.current = null;
    }
    pendingConversationDraftRef.current = null;
  }, []);

  const flushPendingConversationDraft = useCallback((): void => {
    const pendingDraft = pendingConversationDraftRef.current;
    cancelPendingConversationDraftPersist();
    if (pendingDraft) {
      persistConversationDraft(pendingDraft);
    }
  }, [cancelPendingConversationDraftPersist, persistConversationDraft]);

  const clearCurrentConversationDraft = useCallback((): void => {
    setDraftsByConversation(clearStoredTaskConversationDraft(taskConversationDraftKey));
  }, [taskConversationDraftKey]);

  useEffect(() => {
    writeTaskConversationDrafts(draftsByConversation);
  }, [draftsByConversation]);

  useEffect(() => {
    flushPendingConversationDraft();
    setRestoredConversationDraftKey(null);

    const nextDrafts = readTaskConversationDrafts();
    const nextDraft = getTaskConversationDraft(nextDrafts, taskConversationDraftKey);
    setDraftsByConversation(nextDrafts);
    setFollowUp(nextDraft.message);
    setRestoredConversationDraftKey(taskConversationDraftKey);
  }, [flushPendingConversationDraft, setFollowUp, taskConversationDraftKey]);

  useEffect(() => {
    if (!taskConversationDraftKey || restoredConversationDraftKey !== taskConversationDraftKey || editingMessageId) {
      return;
    }

    const pendingDraft = {
      key: taskConversationDraftKey,
      message: followUp,
      attachments
    };
    pendingConversationDraftRef.current = pendingDraft;
    if (conversationDraftPersistTimerRef.current !== null) {
      window.clearTimeout(conversationDraftPersistTimerRef.current);
    }
    conversationDraftPersistTimerRef.current = window.setTimeout(() => {
      if (pendingConversationDraftRef.current !== pendingDraft) {
        return;
      }

      conversationDraftPersistTimerRef.current = null;
      pendingConversationDraftRef.current = null;
      persistConversationDraft(pendingDraft);
    }, TASK_CONVERSATION_DRAFT_PERSIST_DELAY_MS);
  }, [
    attachments,
    editingMessageId,
    followUp,
    persistConversationDraft,
    restoredConversationDraftKey,
    taskConversationDraftKey
  ]);

  useEffect(() => () => {
    flushPendingConversationDraft();
  }, [flushPendingConversationDraft]);

  return {
    taskConversationDraftKey,
    currentConversationDraft,
    cancelPendingConversationDraftPersist,
    flushPendingConversationDraft,
    clearCurrentConversationDraft
  };
}

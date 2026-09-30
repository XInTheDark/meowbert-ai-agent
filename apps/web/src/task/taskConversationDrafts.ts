import type { TaskAttachment } from "../lib/types";
import { normalizeTaskInputDraft } from "./taskInputDrafts";

const TASK_CONVERSATION_DRAFTS_STORAGE_KEY = "meowbert_task_conversation_drafts_v1";
const MAX_TASK_CONVERSATION_DRAFTS = 50;

export interface TaskConversationDraft {
  message: string;
  attachments: TaskAttachment[];
  updatedAt: number;
}

export function buildTaskConversationDraftKey(taskId: string): string {
  return `task:${taskId}`;
}

export function buildEmptyTaskConversationDraft(): TaskConversationDraft {
  return {
    message: "",
    attachments: [],
    updatedAt: 0
  };
}

function normalizeUpdatedAt(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}

export function normalizeTaskConversationDraft(value: unknown): TaskConversationDraft {
  if (!value || typeof value !== "object") {
    return buildEmptyTaskConversationDraft();
  }

  const candidate = value as {
    message?: unknown;
    attachments?: unknown;
    updatedAt?: unknown;
  };

  return {
    message: typeof candidate.message === "string" ? candidate.message : "",
    attachments: normalizeTaskInputDraft({ attachments: candidate.attachments }).attachments,
    updatedAt: normalizeUpdatedAt(candidate.updatedAt)
  };
}

function isNonEmptyDraft(draft: TaskConversationDraft): boolean {
  return draft.message.trim().length > 0 || draft.attachments.length > 0;
}

function haveMatchingAttachments(left: TaskAttachment[], right: TaskAttachment[]): boolean {
  if (left.length !== right.length) {
    return false;
  }

  return left.every((attachment, index) => {
    const other = right[index];
    return other
      && attachment.id === other.id
      && attachment.kind === other.kind
      && attachment.label === other.label
      && attachment.content === other.content
      && attachment.relativePath === other.relativePath
      && attachment.sizeBytes === other.sizeBytes
      && attachment.forceInclude === other.forceInclude;
  });
}

export function taskConversationDraftMatches(
  draft: TaskConversationDraft,
  message: string,
  attachments: TaskAttachment[]
): boolean {
  return draft.message === message && haveMatchingAttachments(draft.attachments, attachments);
}

export function trimTaskConversationDrafts(
  draftsByConversation: Record<string, TaskConversationDraft>,
  maxEntries = MAX_TASK_CONVERSATION_DRAFTS
): Record<string, TaskConversationDraft> {
  const entries = Object.entries(draftsByConversation)
    .filter(([, draft]) => isNonEmptyDraft(draft))
    .sort((left, right) => right[1].updatedAt - left[1].updatedAt)
    .slice(0, Math.max(0, maxEntries));

  return Object.fromEntries(entries);
}

function getStorage(): Storage | null {
  try {
    if (typeof window !== "undefined" && window.localStorage) {
      return window.localStorage;
    }
    if (typeof localStorage !== "undefined" && localStorage) {
      return localStorage;
    }
  } catch {
    return null;
  }
  return null;
}

export function readTaskConversationDrafts(): Record<string, TaskConversationDraft> {
  const storage = getStorage();
  const raw = storage?.getItem(TASK_CONVERSATION_DRAFTS_STORAGE_KEY);
  if (!raw) {
    return {};
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    const entries = parsed && typeof parsed === "object" && "entries" in parsed
      ? (parsed as { entries?: unknown }).entries
      : parsed;
    if (!entries || typeof entries !== "object") {
      return {};
    }

    const normalized = Object.entries(entries as Record<string, unknown>).reduce<Record<string, TaskConversationDraft>>(
      (acc, [conversationKey, draft]) => {
        if (conversationKey.trim().length === 0) {
          return acc;
        }

        const normalizedDraft = normalizeTaskConversationDraft(draft);
        if (isNonEmptyDraft(normalizedDraft)) {
          acc[conversationKey] = normalizedDraft;
        }
        return acc;
      },
      {}
    );

    return trimTaskConversationDrafts(normalized);
  } catch {
    return {};
  }
}

export function writeTaskConversationDrafts(draftsByConversation: Record<string, TaskConversationDraft>): void {
  const storage = getStorage();
  storage?.setItem(
    TASK_CONVERSATION_DRAFTS_STORAGE_KEY,
    JSON.stringify({ entries: trimTaskConversationDrafts(draftsByConversation) })
  );
}

export function getTaskConversationDraft(
  draftsByConversation: Record<string, TaskConversationDraft>,
  conversationKey: string | null
): TaskConversationDraft {
  if (!conversationKey) {
    return buildEmptyTaskConversationDraft();
  }

  return draftsByConversation[conversationKey] ?? buildEmptyTaskConversationDraft();
}

export function updateTaskConversationDraft(
  draftsByConversation: Record<string, TaskConversationDraft>,
  conversationKey: string | null,
  updater: (current: TaskConversationDraft) => Omit<TaskConversationDraft, "updatedAt">,
  now = Date.now()
): Record<string, TaskConversationDraft> {
  if (!conversationKey) {
    return draftsByConversation;
  }

  const currentDraft = getTaskConversationDraft(draftsByConversation, conversationKey);
  const nextDraft = normalizeTaskConversationDraft({
    ...updater(currentDraft),
    updatedAt: now
  });

  if (!isNonEmptyDraft(nextDraft)) {
    return deleteTaskConversationDraft(draftsByConversation, conversationKey);
  }

  return trimTaskConversationDrafts({
    ...draftsByConversation,
    [conversationKey]: nextDraft
  });
}

export function deleteTaskConversationDraft(
  draftsByConversation: Record<string, TaskConversationDraft>,
  conversationKey: string | null
): Record<string, TaskConversationDraft> {
  if (!conversationKey || !(conversationKey in draftsByConversation)) {
    return draftsByConversation;
  }

  const { [conversationKey]: _removed, ...rest } = draftsByConversation;
  return rest;
}

export function clearStoredTaskConversationDraft(
  conversationKey: string | null
): Record<string, TaskConversationDraft> {
  const nextDrafts = deleteTaskConversationDraft(readTaskConversationDrafts(), conversationKey);
  writeTaskConversationDrafts(nextDrafts);
  return nextDrafts;
}

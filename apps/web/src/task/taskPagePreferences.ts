import type {
  TaskAssistantMessageDisplayPreferences,
  TaskUiPreferences,
  TaskPagePreferences,
  UserProfile
} from "../lib/types";

export function buildDefaultTaskAssistantMessageDisplayPreferences(): TaskAssistantMessageDisplayPreferences {
  return {
    collapseLongMessages: true,
    renderMarkdown: true,
    renderCommonHtml: true,
    hideCitationMarkers: true,
    renderUserMessages: false,
    renderLatex: true,
    allowSingleDollarLatex: false,
    showThoughts: true,
    showMessageSummaries: true,
    showScrollToBottomButton: true,
    showSelectionThreadActions: true,
    showSelectionThreadHighlights: true
  };
}

export function buildDefaultTaskUiPreferences(): TaskUiPreferences {
  return {
    enableThreadsPopup: true,
    sendWithShiftEnter: false
  };
}

export function normalizeTaskAssistantMessageDisplayPreferences(
  value: unknown
): TaskAssistantMessageDisplayPreferences {
  const defaults = buildDefaultTaskAssistantMessageDisplayPreferences();
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return defaults;
  }

  const candidate = value as {
    collapseLongMessages?: unknown;
    renderMarkdown?: unknown;
    renderCommonHtml?: unknown;
    hideCitationMarkers?: unknown;
    renderUserMessages?: unknown;
    renderLatex?: unknown;
    allowSingleDollarLatex?: unknown;
    showThoughts?: unknown;
    showMessageSummaries?: unknown;
    showScrollToBottomButton?: unknown;
    showSelectionThreadActions?: unknown;
    showSelectionThreadHighlights?: unknown;
  };

  return {
    collapseLongMessages:
      candidate.collapseLongMessages === false ? false : defaults.collapseLongMessages,
    renderMarkdown: candidate.renderMarkdown === false ? false : defaults.renderMarkdown,
    renderCommonHtml: candidate.renderCommonHtml === false ? false : defaults.renderCommonHtml,
    hideCitationMarkers: candidate.hideCitationMarkers === false ? false : defaults.hideCitationMarkers,
    renderUserMessages: candidate.renderUserMessages === true,
    renderLatex: candidate.renderLatex === false ? false : defaults.renderLatex,
    allowSingleDollarLatex: candidate.allowSingleDollarLatex === true,
    showThoughts: candidate.showThoughts === false ? false : defaults.showThoughts,
    showMessageSummaries: candidate.showMessageSummaries !== false,
    showScrollToBottomButton: candidate.showScrollToBottomButton === false ? false : defaults.showScrollToBottomButton,
    showSelectionThreadActions:
      candidate.showSelectionThreadActions === false ? false : defaults.showSelectionThreadActions,
    showSelectionThreadHighlights:
      candidate.showSelectionThreadHighlights === false ? false : defaults.showSelectionThreadHighlights
  };
}

export function normalizeTaskUiPreferences(value: unknown): TaskUiPreferences {
  const defaults = buildDefaultTaskUiPreferences();
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return defaults;
  }

  const candidate = value as {
    enableThreadsPopup?: unknown;
    sendWithShiftEnter?: unknown;
  };

  return {
    enableThreadsPopup: candidate.enableThreadsPopup === false ? false : defaults.enableThreadsPopup,
    sendWithShiftEnter: candidate.sendWithShiftEnter === true
  };
}

export function normalizeTaskPagePreferences(value: unknown): TaskPagePreferences {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {
      assistantMessageDisplay: buildDefaultTaskAssistantMessageDisplayPreferences(),
      ui: buildDefaultTaskUiPreferences()
    };
  }

  const candidate = value as {
    assistantMessageDisplay?: unknown;
    ui?: unknown;
  };

  return {
    assistantMessageDisplay: normalizeTaskAssistantMessageDisplayPreferences(candidate.assistantMessageDisplay),
    ui: normalizeTaskUiPreferences(candidate.ui)
  };
}

export function getTaskAssistantMessageDisplayPreferencesForUser(
  user: Pick<UserProfile, "task_page_preferences"> | null | undefined
): TaskAssistantMessageDisplayPreferences {
  return normalizeTaskPagePreferences(user?.task_page_preferences).assistantMessageDisplay;
}

export function getTaskUiPreferencesForUser(
  user: Pick<UserProfile, "task_page_preferences"> | null | undefined
): TaskUiPreferences {
  return normalizeTaskPagePreferences(user?.task_page_preferences).ui;
}

export function hasCustomTaskAssistantMessageDisplayPreferences(
  value: TaskAssistantMessageDisplayPreferences
): boolean {
  const defaults = buildDefaultTaskAssistantMessageDisplayPreferences();
  return value.collapseLongMessages !== defaults.collapseLongMessages
    || value.renderMarkdown !== defaults.renderMarkdown
    || value.renderCommonHtml !== defaults.renderCommonHtml
    || value.hideCitationMarkers !== defaults.hideCitationMarkers
    || value.renderUserMessages !== defaults.renderUserMessages
    || value.renderLatex !== defaults.renderLatex
    || value.allowSingleDollarLatex !== defaults.allowSingleDollarLatex
    || value.showThoughts !== defaults.showThoughts
    || value.showMessageSummaries !== defaults.showMessageSummaries
    || value.showScrollToBottomButton !== defaults.showScrollToBottomButton
    || value.showSelectionThreadActions !== defaults.showSelectionThreadActions
    || value.showSelectionThreadHighlights !== defaults.showSelectionThreadHighlights;
}

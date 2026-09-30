export interface TaskAssistantMessageDisplayPreferences {
  collapseLongMessages: boolean;
  renderMarkdown: boolean;
  renderCommonHtml: boolean;
  hideCitationMarkers: boolean;
  renderUserMessages: boolean;
  renderLatex: boolean;
  allowSingleDollarLatex: boolean;
  showThoughts: boolean;
  showMessageSummaries: boolean;
  showScrollToBottomButton: boolean;
  showSelectionThreadActions: boolean;
  showSelectionThreadHighlights: boolean;
}

export interface TaskUiPreferences {
  enableThreadsPopup: boolean;
  sendWithShiftEnter: boolean;
}

export interface TaskPagePreferences {
  assistantMessageDisplay: TaskAssistantMessageDisplayPreferences;
  ui: TaskUiPreferences;
}

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

  const candidate = value as Partial<Record<keyof TaskAssistantMessageDisplayPreferences, unknown>>;
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

  const candidate = value as Partial<Record<keyof TaskUiPreferences, unknown>>;
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

  const candidate = value as { assistantMessageDisplay?: unknown; ui?: unknown };
  return {
    assistantMessageDisplay: normalizeTaskAssistantMessageDisplayPreferences(candidate.assistantMessageDisplay),
    ui: normalizeTaskUiPreferences(candidate.ui)
  };
}

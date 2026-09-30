import { describe, expect, it } from "vitest";
import {
  hasCustomTaskAssistantMessageDisplayPreferences,
  normalizeTaskAssistantMessageDisplayPreferences
} from "./taskPagePreferences";

describe("taskPagePreferences", () => {
  it("defaults selected-text thread highlights on", () => {
    const preferences = normalizeTaskAssistantMessageDisplayPreferences({});

    expect(preferences.renderCommonHtml).toBe(true);
    expect(preferences.hideCitationMarkers).toBe(true);
    expect(preferences.showSelectionThreadHighlights).toBe(true);
    expect(hasCustomTaskAssistantMessageDisplayPreferences(preferences)).toBe(false);
  });

  it("normalizes and detects disabled common HTML rendering", () => {
    const preferences = normalizeTaskAssistantMessageDisplayPreferences({ renderCommonHtml: false });

    expect(preferences.renderCommonHtml).toBe(false);
    expect(hasCustomTaskAssistantMessageDisplayPreferences(preferences)).toBe(true);
  });

  it("normalizes and detects disabled citation marker cleanup", () => {
    const preferences = normalizeTaskAssistantMessageDisplayPreferences({ hideCitationMarkers: false });

    expect(preferences.hideCitationMarkers).toBe(false);
    expect(hasCustomTaskAssistantMessageDisplayPreferences(preferences)).toBe(true);
  });

  it("normalizes and detects a disabled selected-text highlight preference", () => {
    const preferences = normalizeTaskAssistantMessageDisplayPreferences({
      showSelectionThreadHighlights: false
    });

    expect(preferences.showSelectionThreadHighlights).toBe(false);
    expect(hasCustomTaskAssistantMessageDisplayPreferences(preferences)).toBe(true);
  });
});

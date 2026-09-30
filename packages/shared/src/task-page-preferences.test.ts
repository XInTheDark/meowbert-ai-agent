import { describe, expect, it } from "vitest";
import {
  buildDefaultTaskAssistantMessageDisplayPreferences,
  normalizeTaskAssistantMessageDisplayPreferences
} from "./task-page-preferences";

describe("task page preferences", () => {
  it("shows selected-text thread highlights by default", () => {
    expect(buildDefaultTaskAssistantMessageDisplayPreferences().renderCommonHtml).toBe(true);
    expect(normalizeTaskAssistantMessageDisplayPreferences({}).renderCommonHtml).toBe(true);
    expect(normalizeTaskAssistantMessageDisplayPreferences({}).hideCitationMarkers).toBe(true);
    expect(buildDefaultTaskAssistantMessageDisplayPreferences().showSelectionThreadHighlights).toBe(true);
    expect(normalizeTaskAssistantMessageDisplayPreferences({}).showSelectionThreadHighlights).toBe(true);
  });

  it("preserves an explicit request to render HTML as text", () => {
    expect(normalizeTaskAssistantMessageDisplayPreferences({
      renderCommonHtml: false
    }).renderCommonHtml).toBe(false);
  });

  it("preserves an explicit request to show citation markers", () => {
    expect(normalizeTaskAssistantMessageDisplayPreferences({
      hideCitationMarkers: false
    }).hideCitationMarkers).toBe(false);
  });

  it("preserves an explicit request to hide selected-text thread highlights", () => {
    expect(normalizeTaskAssistantMessageDisplayPreferences({
      showSelectionThreadHighlights: false
    }).showSelectionThreadHighlights).toBe(false);
  });
});

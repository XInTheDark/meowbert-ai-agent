import { describe, expect, it } from "vitest";
import {
  getNextTopbarCollapsedState,
  MOBILE_TOPBAR_COLLAPSE_SCROLL_TOP_PX
} from "./taskDetailTopbarState";

describe("getNextTopbarCollapsedState", () => {
  it("keeps the topbar expanded before the user scrolls past the collapse threshold", () => {
    expect(getNextTopbarCollapsedState({
      currentScrollTop: MOBILE_TOPBAR_COLLAPSE_SCROLL_TOP_PX,
      previousScrollTop: MOBILE_TOPBAR_COLLAPSE_SCROLL_TOP_PX - 5,
      wasCollapsed: false
    })).toBe(false);
  });

  it("collapses the topbar after scrolling down past the threshold", () => {
    expect(getNextTopbarCollapsedState({
      currentScrollTop: MOBILE_TOPBAR_COLLAPSE_SCROLL_TOP_PX + 12,
      previousScrollTop: MOBILE_TOPBAR_COLLAPSE_SCROLL_TOP_PX - 4,
      wasCollapsed: false
    })).toBe(true);
  });

  it("keeps the topbar collapsed while scrolling back up", () => {
    expect(getNextTopbarCollapsedState({
      currentScrollTop: MOBILE_TOPBAR_COLLAPSE_SCROLL_TOP_PX - 10,
      previousScrollTop: MOBILE_TOPBAR_COLLAPSE_SCROLL_TOP_PX + 30,
      wasCollapsed: true
    })).toBe(true);
  });

  it("does not re-collapse an already expanded topbar unless the user scrolls down again", () => {
    expect(getNextTopbarCollapsedState({
      currentScrollTop: MOBILE_TOPBAR_COLLAPSE_SCROLL_TOP_PX - 6,
      previousScrollTop: MOBILE_TOPBAR_COLLAPSE_SCROLL_TOP_PX + 18,
      wasCollapsed: false
    })).toBe(false);
  });
});

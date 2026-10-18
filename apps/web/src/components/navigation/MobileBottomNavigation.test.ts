import { describe, expect, it } from "vitest";
import { isMobileBottomNavigationVisible } from "./MobileBottomNavigation";

describe("isMobileBottomNavigationVisible", () => {
  it("keeps primary navigation on task lists and the composer but not inside a conversation", () => {
    expect(isMobileBottomNavigationVisible("/app/workspace/projects/project/tasks")).toBe(true);
    expect(isMobileBottomNavigationVisible("/app/workspace/projects/project/tasks/new")).toBe(true);
    expect(isMobileBottomNavigationVisible("/app/workspace/projects/project/tasks/task")).toBe(false);
  });

  it("preserves full-screen routes and other project navigation", () => {
    expect(isMobileBottomNavigationVisible("/app/workspace/projects/project/shell/session")).toBe(false);
    expect(isMobileBottomNavigationVisible("/app/workspace/projects/project/canvases/canvas")).toBe(false);
    expect(isMobileBottomNavigationVisible("/app/workspace/projects/project/overview")).toBe(true);
  });
});

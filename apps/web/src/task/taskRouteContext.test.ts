import { describe, expect, it } from "vitest";
import { buildTaskRoutePath, resolveTaskRouteContext } from "./taskRouteContext";

describe("resolveTaskRouteContext", () => {
  it("prefers the task's persisted workspace and environment ids", () => {
    expect(resolveTaskRouteContext({
      routeWorkspaceId: "workspace-route",
      routeEnvironmentId: "env-route",
      taskWorkspaceId: "workspace-task",
      taskEnvironmentId: "env-task"
    })).toEqual({
      workspaceId: "workspace-task",
      projectId: "env-task",
      environmentId: "env-task",
      needsRouteCorrection: true
    });
  });

  it("keeps the route ids when the task ids are not available yet", () => {
    expect(resolveTaskRouteContext({
      routeWorkspaceId: "workspace-route",
      routeEnvironmentId: "env-route",
      taskWorkspaceId: null,
      taskEnvironmentId: null
    })).toEqual({
      workspaceId: "workspace-route",
      projectId: "env-route",
      environmentId: "env-route",
      needsRouteCorrection: false
    });
  });

  it("does not request a redirect when the route already matches the task", () => {
    expect(resolveTaskRouteContext({
      routeWorkspaceId: "workspace-task",
      routeEnvironmentId: "env-task",
      taskWorkspaceId: "workspace-task",
      taskEnvironmentId: "env-task"
    })).toEqual({
      workspaceId: "workspace-task",
      projectId: "env-task",
      environmentId: "env-task",
      needsRouteCorrection: false
    });
  });
});

describe("buildTaskRoutePath", () => {
  it("builds the canonical task detail route", () => {
    expect(buildTaskRoutePath({
      workspaceId: "workspace-1",
      environmentId: "env-2",
      taskId: "task-3"
    })).toBe("/app/workspace-1/projects/env-2/tasks/task-3");
  });
});

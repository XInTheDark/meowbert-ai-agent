import { beforeEach, expect, it, vi } from "vitest";
vi.mock("../../lib/db.js", () => ({ query: vi.fn(), withTransaction: vi.fn() }));
vi.mock("../../lib/config.js", () => ({ config: { server: { publicUrl: "https://desktop.example", internalUrl: "http://api.internal" }, security: { jwtSecret: "test" } } }));
vi.mock("../agent-db/index.js", () => ({}));
vi.mock("../agent-db/conversation-history.js", () => ({}));
vi.mock("../project-master/listeners.js", () => ({}));
vi.mock("../memory/index.js", () => ({ searchMemoryIndex: vi.fn() }));
vi.mock("../task-schedules/service.js", () => ({}));
vi.mock("../tasks/subtasks.js", () => ({ createSubtaskFromTool: vi.fn(), startSubtasksFromTool: vi.fn() }));
vi.mock("../agent/live-sync-client.js", () => ({ searchTaskLiveSyncFolder: vi.fn() }));
vi.mock("../agent/artifacts.js", () => ({}));
vi.mock("../computer/computer-use.js", () => ({ requestDesktopComputerAction: vi.fn() }));
vi.mock("../runtime/persistent-shell-sessions.js", () => ({}));
import { config } from "../../lib/config.js";
import { searchMemoryIndex } from "../memory/index.js";
import { createSubtaskFromTool, startSubtasksFromTool } from "../tasks/subtasks.js";
import { searchTaskLiveSyncFolder } from "../agent/live-sync-client.js";
import { requestDesktopComputerAction } from "../computer/computer-use.js";
import { createDbPlatformToolHost } from "./platform-tools.js";
import type { ServerRunState } from "./bootstrap.js";

function fixture() {
  const run = { job: { taskId: "task", executionTarget: { kind: "local", mode: "host", deviceId: "device" } },
    taskDir: "/owned/task", snapshot: { task: { workspace_id: "workspace", environment_id: "project" } },
    bootstrap: { runActorUserId: "owner", roots: { workspaceRoot: "/owned/workspace" } } } as ServerRunState;
  return { run, platform: createDbPlatformToolHost(() => run) };
}
beforeEach(() => vi.clearAllMocks());

it.each(["all", "workspace", "current_project"] as const)("keeps %s memory searches in the resolved workspace/project", async (scope) => {
  const { platform } = fixture();
  const input = { query: "needle", limit: 7, paths: ["notes.md"], scope, workspaceRoot: "/foreign", currentProjectId: "foreign" };
  await platform.searchMemory(input as never);
  expect(searchMemoryIndex).toHaveBeenCalledExactlyOnceWith({ ...input, workspaceRoot: "/owned/workspace", currentProjectId: "project" });
});

it("keeps platform mutations and live-folder searches bound to the run's identity", async () => {
  const { platform } = fixture();
  const input = { parentTaskId: "foreign", workspaceId: "foreign", environmentId: "foreign", userId: "foreign",
    taskId: "foreign", message: "hello", taskRelativePath: "context/Drive", subfolder: "reports" };
  await platform.createSubtask(input as never);
  await platform.startSubtasks(input as never);
  await platform.liveSyncFolderSearch(input as never);
  await platform.requestDesktopComputerAction(input as never);
  for (const fn of [createSubtaskFromTool, startSubtasksFromTool]) expect(fn).toHaveBeenCalledExactlyOnceWith({
    ...input, parentTaskId: "task", workspaceId: "workspace", environmentId: "project"
  });
  expect(searchTaskLiveSyncFolder).toHaveBeenCalledExactlyOnceWith({ ...input, userId: "owner", taskId: "task", workspaceId: "workspace" });
  expect(requestDesktopComputerAction).toHaveBeenCalledExactlyOnceWith({ ...input, userId: "owner", taskId: "task" });
});

it.each(["host", "sandbox", "cloud"] as const)("uses the appropriate source proxy address for %s processes", async (mode) => {
  const { run, platform } = fixture();
  run.job.executionTarget = mode === "cloud" ? { kind: "cloud" } : { kind: "local", mode, deviceId: "device" };
  const env = await platform.issueSourceAccess({ sourceId: "google-drive", provider: "google-drive" });
  expect(env.SOURCE_PROXY_BASE_URL).toBe(mode === "cloud" ? "http://api.internal" : "https://desktop.example");
});

it("keeps localhost reachable by native host skills and rewrites it only for sandbox skills", async () => {
  const original = config.server.publicUrl;
  config.server.publicUrl = "http://localhost:4000";
  try {
    const { run, platform } = fixture();
    const input = { sourceId: "google-drive", provider: "google-drive" };
    expect((await platform.issueSourceAccess(input)).SOURCE_PROXY_BASE_URL).toBe("http://localhost:4000");
    run.job.executionTarget = { kind: "local", mode: "sandbox", deviceId: "device" };
    expect((await platform.issueSourceAccess(input)).SOURCE_PROXY_BASE_URL).toBe("http://host.docker.internal:4000");
  } finally { config.server.publicUrl = original; }
});

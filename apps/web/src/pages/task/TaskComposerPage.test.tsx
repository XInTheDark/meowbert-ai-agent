/** @vitest-environment jsdom */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { updateTaskInputDraftForEnvironment, writeTaskInputDrafts } from "../../task/taskInputDrafts";
import { buildDefaultTaskParameters } from "../../task/taskParameters";
import type { TaskParameters, TaskWorkflowComposerConfig } from "../../lib/types";

const mocks = vi.hoisted(() => ({
  post: vi.fn(), refreshTasks: vi.fn(), input: {} as { onSubmit: () => Promise<void>; onTaskParametersChange: (value: TaskParameters) => void },
  attachments: [], catalog: { availableSkills: [], availableAgents: [], availableSources: [], attachableSources: [], defaultAgentId: null, modelSliderAgentIds: [] }
}));
vi.mock("../../contexts/WorkspaceContext", () => ({ useWorkspaceApp: () => ({ api: { post: mocks.post }, token: "token", user: null,
  activeWorkspaceId: "ws", activeEnvironmentId: "project", environments: [], workspaceSettings: {}, workspaces: [], refreshTasks: mocks.refreshTasks }) }));
vi.mock("../../contexts/AppRuntimeContext", () => ({ useAppRuntime: () => ({ capabilities: { isDesktop: false } }) }));
vi.mock("../../hooks/useTaskInputCatalog", () => ({ useTaskInputCatalog: () => mocks.catalog }));
vi.mock("../../hooks/useFileUpload", () => ({ useFileUpload: () => ({ attachments: mocks.attachments, pendingUploads: [], isUploading: false }) }));
vi.mock("../../subscription/usageLimits", () => ({ useSubscriptionUsageWarning: () => null }));
vi.mock("../../project/suggestedActions/useProjectSuggestedActions", () => ({ useProjectSuggestedActions: () => [] }));
vi.mock("../../components/taskConversation/ChatInput", () => ({ ChatInput: (props: typeof mocks.input) => { mocks.input = props; return null; } }));
vi.mock("../../components/modals/EnvironmentFilePickerModal", () => ({ EnvironmentFilePickerModal: () => null }));
vi.mock("../../components/modals/CanvasPickerModal", () => ({ CanvasPickerModal: () => null }));
vi.mock("../../components/modals/SourceFilePickerModal", () => ({ SourceFilePickerModal: () => null }));
import { TaskComposerPage } from "./TaskComposerPage";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | null = null;
let container: HTMLDivElement;
beforeEach(() => {
  const storage = new Map<string, string>();
  vi.stubGlobal("localStorage", { getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value), removeItem: (key: string) => storage.delete(key) });
  mocks.post.mockReset().mockResolvedValue({ taskId: "created" });
  mocks.refreshTasks.mockResolvedValue(undefined);
  container = document.createElement("div"); document.body.appendChild(container);
});
afterEach(() => { act(() => root?.unmount()); root = null; container?.remove(); vi.unstubAllGlobals(); });

function mount() {
  root = createRoot(container);
  act(() => root!.render(<MemoryRouter><TaskComposerPage /></MemoryRouter>));
}

it("sends the selected swarm spawn effort when creating a task", async () => {
  writeTaskInputDrafts(updateTaskInputDraftForEnvironment({}, "project", (draft) => ({
    ...draft, prompt: "Do the work", workflow: { ...draft.workflow, type: "agent_swarm", spawnEffort: 5 } as TaskWorkflowComposerConfig
  })));
  mount();
  await act(async () => { await mocks.input.onSubmit(); });
  expect(mocks.post).toHaveBeenCalledWith("/api/projects/project/tasks", expect.objectContaining({ workflow: expect.objectContaining({ type: "agent_swarm", spawnEffort: 5 }) }));
});

it("omits incompatible restrictions and incognito when a schedule is selected", async () => {
  writeTaskInputDrafts(updateTaskInputDraftForEnvironment({}, "project", (draft) => ({
    ...draft, prompt: "Do the work", restrictions: { readOnly: true, networkDisabled: true }
  })));
  mount();
  act(() => { container.querySelector<HTMLButtonElement>('[aria-label="Turn on incognito chat"]')!.click(); });
  act(() => { mocks.input.onTaskParametersChange({ ...buildDefaultTaskParameters(), schedule: {
    type: "scheduled", repeat: "0 9 * * *", timezone: "Asia/Singapore", timeLimitSeconds: null
  } }); });
  expect(container.querySelector<HTMLButtonElement>('[title="Incognito chat is disabled for scheduled tasks"]')!.disabled).toBe(true);
  await act(async () => { await mocks.input.onSubmit(); });
  const payload = mocks.post.mock.calls[0][1];
  expect(payload.schedule).toMatchObject({ type: "scheduled" });
  expect(payload).not.toHaveProperty("restrictions");
  expect(payload).not.toHaveProperty("incognito");
});

/** @vitest-environment jsdom */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  post: vi.fn(), close: vi.fn(), focus: vi.fn(), save: vi.fn(),
  context: { workspaceId: "ws", environmentId: "project" },
  input: {} as { onSubmit: () => void; onChange: (value: string) => void; isSubmitting: boolean },
  attachments: [], catalog: { availableSkills: [], availableAgents: [], availableSources: [], attachableSources: [], defaultAgentId: null, modelSliderAgentIds: [] }
}));
vi.mock("../../lib/api", () => ({ createApiClient: () => ({ post: mocks.post, get: async (path: string) => {
  if (path === "/api/auth/me") return { user: {}, workspaces: [{ id: "ws", name: "Workspace" }] };
  if (path.endsWith("/projects")) return { items: [{ id: "project", name: "Project" }] };
  return {};
} }) }));
vi.mock("../../contexts/AppRuntimeContext", () => ({ useAppRuntime: () => ({ activeContext: mocks.context,
  capabilities: { isDesktop: true }, saveActiveContext: mocks.save,
  platform: { onQuickAgentActivated: () => () => {}, closeQuickAgent: mocks.close, focusMainWindow: mocks.focus } }) }));
vi.mock("../../hooks/useTaskInputCatalog", () => ({ useTaskInputCatalog: () => mocks.catalog }));
vi.mock("../../hooks/useFileUpload", () => ({ useFileUpload: () => ({ attachments: mocks.attachments, pendingUploads: [], isUploading: false, clearAttachments: () => {} }) }));
vi.mock("../../components/taskConversation/ChatInput", () => ({ ChatInput: (props: typeof mocks.input) => { mocks.input = props; return null; } }));
vi.mock("../../components/modals/EnvironmentFilePickerModal", () => ({ EnvironmentFilePickerModal: () => null }));
vi.mock("../../components/modals/SourceFilePickerModal", () => ({ SourceFilePickerModal: () => null }));
import { QuickAgentPage } from "./QuickAgentPage";

it("blocks task submission while the latest desktop authentication state is loading", async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  mocks.post.mockResolvedValue({ taskId: "created" });
  const container = document.createElement("div");
  const root = createRoot(container);
  try {
    await act(async () => { root.render(<QuickAgentPage token="token" requiresServerSelection={false} isRuntimeRefreshing />); });
    act(() => { mocks.input.onChange("Do the work"); });
    expect(mocks.input.isSubmitting).toBe(true);
    await act(async () => { mocks.input.onSubmit(); });
    expect(mocks.post).not.toHaveBeenCalled();
    await act(async () => { root.render(<QuickAgentPage token="token" requiresServerSelection={false} isRuntimeRefreshing={false} />); });
    await act(async () => { mocks.input.onSubmit(); });
    expect(mocks.post).toHaveBeenCalledWith("/api/projects/project/tasks", expect.objectContaining({ message: "Do the work" }));
  } finally { await act(async () => { root.unmount(); }); }
});

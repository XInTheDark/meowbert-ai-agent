import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("../../lib/db.js", () => ({ query: vi.fn() }));
vi.mock("@meowbert/shared", async (original) => ({ ...await original<typeof import("@meowbert/shared")>(), loadConversationNavigation: vi.fn() }));
import { loadConversationNavigation } from "@meowbert/shared";
import { prepareConversationOrganization } from "./conversation-organization.js";

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(loadConversationNavigation).mockResolvedValue({ enabled: true, active_leaf_message_id: null, turns: [], messages: [], outline: null, map: null });
});
describe("per-run organization gate", () => {
  it.each([
    { settings: {}, subtask: false, thread: false, expected: true },
    { settings: { newMessageOrganizationEnabled: false }, subtask: false, thread: false, expected: false },
    { settings: {}, subtask: true, thread: false, expected: false },
    { settings: {}, subtask: true, thread: true, expected: true }
  ])("pins the workspace setting for $settings in thread=$thread subtask=$subtask", async ({ settings, subtask, thread, expected }) => {
    const result = await prepareConversationOrganization({ isSubtask: subtask, isQualityReviewSpecialist: false,
      snapshot: { workspace_model_defaults: settings, task: { is_thread: thread }, branch_leaf_message_id: null }
    } as never, { taskId: "task" } as never);
    expect(Boolean(result)).toBe(expected);
    expect(loadConversationNavigation).toHaveBeenCalledTimes(expected ? 1 : 0);
  });
});

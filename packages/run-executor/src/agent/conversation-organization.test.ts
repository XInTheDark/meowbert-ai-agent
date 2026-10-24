import { beforeEach, describe, expect, it, vi } from "vitest";
import { prepareConversationOrganization } from "./conversation-organization.js";

const loadConversationNavigation = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  loadConversationNavigation.mockResolvedValue({ enabled: true, active_leaf_message_id: null, turns: [], messages: [], outline: null, map: null });
});
describe("per-run organization gate", () => {
  it.each([
    { settings: {}, subtask: false, thread: false, expected: true },
    { settings: { newMessageOrganizationEnabled: false }, subtask: false, thread: false, expected: false },
    { settings: {}, subtask: true, thread: false, expected: false },
    { settings: {}, subtask: true, thread: true, expected: true }
  ])("pins the workspace setting for $settings in thread=$thread subtask=$subtask", async ({ settings, subtask, thread, expected }) => {
    const result = await prepareConversationOrganization({ isSubtask: subtask, isQualityReviewSpecialist: false,
      control: { loadConversationNavigation },
      snapshot: { workspace_model_defaults: settings, task: { is_thread: thread }, branch_leaf_message_id: null }
    } as never, { taskId: "task" } as never);
    expect(Boolean(result)).toBe(expected);
    expect(loadConversationNavigation).toHaveBeenCalledTimes(expected ? 1 : 0);
  });
});

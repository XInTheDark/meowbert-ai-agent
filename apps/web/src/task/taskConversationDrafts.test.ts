import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildTaskConversationDraftKey,
  clearStoredTaskConversationDraft,
  deleteTaskConversationDraft,
  getTaskConversationDraft,
  normalizeTaskConversationDraft,
  readTaskConversationDrafts,
  trimTaskConversationDrafts,
  updateTaskConversationDraft,
  writeTaskConversationDrafts
} from "./taskConversationDrafts";

describe("taskConversationDrafts", () => {
  beforeEach(() => {
    const storage = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: vi.fn((key: string) => storage.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => {
        storage.set(key, value);
      }),
      removeItem: vi.fn((key: string) => {
        storage.delete(key);
      }),
      clear: vi.fn(() => {
        storage.clear();
      })
    });
  });

  it("normalizes message text and stored attachments", () => {
    const normalized = normalizeTaskConversationDraft({
      message: "remember this",
      attachments: [
        {
          id: "file-1",
          kind: "file",
          label: "report.txt",
          content: "inputs/report.txt",
          relativePath: "inputs/report.txt",
          sizeBytes: 12,
          forceInclude: true
        },
        {
          kind: "bad",
          label: "bad",
          content: "bad"
        }
      ],
      updatedAt: 42
    });

    expect(normalized).toEqual({
      message: "remember this",
      attachments: [
        {
          id: "file-1",
          kind: "file",
          label: "report.txt",
          content: "inputs/report.txt",
          relativePath: "inputs/report.txt",
          sizeBytes: 12,
          forceInclude: true
        }
      ],
      updatedAt: 42
    });
  });

  it("updates and deletes a per-task conversation draft", () => {
    const key = buildTaskConversationDraftKey("task-1");
    const updated = updateTaskConversationDraft({}, key, (current) => ({
      ...current,
      message: "hello"
    }), 100);

    expect(getTaskConversationDraft(updated, key)).toEqual({
      message: "hello",
      attachments: [],
      updatedAt: 100
    });

    const cleared = updateTaskConversationDraft(updated, key, (current) => ({
      ...current,
      message: ""
    }), 101);

    expect(cleared).toEqual({});
    expect(deleteTaskConversationDraft(updated, key)).toEqual({});
  });

  it("trims least-recently-used drafts", () => {
    const trimmed = trimTaskConversationDrafts({
      a: { message: "a", attachments: [], updatedAt: 1 },
      b: { message: "b", attachments: [], updatedAt: 3 },
      c: { message: "c", attachments: [], updatedAt: 2 }
    }, 2);

    expect(Object.keys(trimmed)).toEqual(["b", "c"]);
  });

  it("round-trips localStorage with empty drafts removed", () => {
    writeTaskConversationDrafts({
      "task:1": { message: "draft", attachments: [], updatedAt: 10 },
      "task:2": { message: "   ", attachments: [], updatedAt: 11 }
    });

    expect(readTaskConversationDrafts()).toEqual({
      "task:1": { message: "draft", attachments: [], updatedAt: 10 }
    });
  });

  it("clears a stored conversation draft synchronously", () => {
    writeTaskConversationDrafts({
      "task:1": { message: "sent", attachments: [], updatedAt: 10 },
      "task:2": { message: "keep", attachments: [], updatedAt: 11 }
    });

    expect(clearStoredTaskConversationDraft("task:1")).toEqual({
      "task:2": { message: "keep", attachments: [], updatedAt: 11 }
    });
    expect(readTaskConversationDrafts()).toEqual({
      "task:2": { message: "keep", attachments: [], updatedAt: 11 }
    });
  });
});

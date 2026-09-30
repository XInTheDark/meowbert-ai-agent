/** @vitest-environment jsdom */

import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppRuntimeContext } from "../../contexts/AppRuntimeContext";
import { ChatInput, canSubmitChatInput, shouldQueueSubmit, shouldSubmitOnEnter } from "./ChatInput";

const { attachFilesMenuPropsMock } = vi.hoisted(() => ({
  attachFilesMenuPropsMock: vi.fn()
}));

vi.mock("../files/AttachFilesMenu", () => ({
  AttachFilesMenu: (props: Record<string, unknown>) => {
    attachFilesMenuPropsMock(props);
    return <button type="button" data-testid="attach-files-menu" disabled={Boolean(props.disabled)}>Attach</button>;
  }
}));

vi.mock("../tasks/ToolOptionsDropdown", () => ({
  ToolOptionsDropdown: () => null
}));

vi.mock("../tasks/SourceOptionsDropdown", () => ({
  SourceOptionsDropdown: () => null
}));

vi.mock("../tasks/TaskParametersDropdown", () => ({
  TaskParametersDropdown: () => null
}));

vi.mock("../tasks/AgentDropdown", () => ({
  AgentDropdown: () => null
}));

vi.mock("../files/CreateTextFileModal", () => ({
  CreateTextFileModal: () => null
}));

function createAppRuntimeValue() {
  return {
    platform: {
      pickFiles: vi.fn(async () => []),
      onNavigateRequested: vi.fn(),
      onQuickAgentActivated: vi.fn()
    },
    capabilities: {
      isDesktop: false,
      supportsNativeFileDialogs: false,
      supportsNativeDownloads: false,
      supportsRevealPath: false,
      supportsServerProfiles: false
    },
    serverProfilesState: { profiles: [], activeProfileId: null },
    activeServerProfile: null,
    saveServerProfilesState: vi.fn(async () => undefined),
    shortcutPreferences: {},
    saveShortcutPreferences: vi.fn(async () => undefined),
    activeContext: { workspaceId: null, environmentId: null },
    saveActiveContext: vi.fn(async () => undefined),
    publicServerConfig: null,
    refreshPublicServerConfig: vi.fn(async () => undefined)
  } as const;
}

function click(element: Element | null): void {
  element?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
}

describe("shouldSubmitOnEnter", () => {
  it("submits on desktop Enter", () => {
    expect(shouldSubmitOnEnter({
      key: "Enter",
      shiftKey: false,
      isNarrowViewport: false
    })).toBe(true);
  });

  it("keeps mobile Enter as newline by default", () => {
    expect(shouldSubmitOnEnter({
      key: "Enter",
      shiftKey: false,
      isNarrowViewport: true
    })).toBe(false);
  });

  it("allows submit-on-Enter override for quick agent on narrow viewports", () => {
    expect(shouldSubmitOnEnter({
      key: "Enter",
      shiftKey: false,
      isNarrowViewport: true,
      mobileEnterBehavior: "submit"
    })).toBe(true);
  });

  it("never submits on Shift+Enter", () => {
    expect(shouldSubmitOnEnter({
      key: "Enter",
      shiftKey: true,
      isNarrowViewport: false,
      mobileEnterBehavior: "submit"
    })).toBe(false);
  });

  it("requires Cmd/Ctrl+Enter when the modifier-submit preference is enabled", () => {
    expect(shouldSubmitOnEnter({
      key: "Enter",
      shiftKey: false,
      isNarrowViewport: false,
      submitWithShiftEnter: true
    })).toBe(false);

    expect(shouldSubmitOnEnter({
      key: "Enter",
      shiftKey: true,
      isNarrowViewport: false,
      metaKey: false,
      ctrlKey: false,
      submitWithShiftEnter: true
    })).toBe(false);

    expect(shouldSubmitOnEnter({
      key: "Enter",
      shiftKey: false,
      metaKey: true,
      isNarrowViewport: false,
      submitWithShiftEnter: true
    })).toBe(true);

    expect(shouldSubmitOnEnter({
      key: "Enter",
      shiftKey: false,
      ctrlKey: true,
      isNarrowViewport: false,
      submitWithShiftEnter: true
    })).toBe(true);
  });
});

describe("chat input submit flow", () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  beforeEach(() => {
    attachFilesMenuPropsMock.mockClear();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: vi.fn().mockImplementation(() => ({
        matches: false,
        media: "",
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn()
      }))
    });
  });

  afterEach(async () => {
    if (root) {
      await act(async () => {
        root?.unmount();
      });
    }

    container?.remove();
    container = null;
    root = null;
  });

  it("recognizes queued-submit conditions", () => {
    expect(canSubmitChatInput("hello", [])).toBe(true);
    expect(canSubmitChatInput("   ", [])).toBe(false);
    expect(canSubmitChatInput("   ", [], 1)).toBe(true);
    expect(canSubmitChatInput("   ", [{
      id: "attachment-1",
      kind: "file",
      label: "notes.txt",
      content: "inputs/notes.txt",
      relativePath: "inputs/notes.txt",
      sizeBytes: 12
    }])).toBe(true);

    expect(shouldQueueSubmit({
      hasContent: true,
      isSubmitting: false,
      isUploading: true
    })).toBe(true);
    expect(shouldQueueSubmit({
      hasContent: true,
      isSubmitting: true,
      isUploading: true
    })).toBe(false);
  });

  it("queues submission until uploads finish and keeps attach controls available", async () => {
    const onSubmit = vi.fn();

    function Harness() {
      const [isUploading, setIsUploading] = useState(true);

      return (
        <AppRuntimeContext.Provider value={createAppRuntimeValue() as any}>
          <>
            <ChatInput
              value="Please send this"
              onChange={() => {}}
              onSubmit={onSubmit}
              isSubmitting={false}
              attachments={[]}
              onRemoveAttachment={() => {}}
              onAttachFiles={() => {}}
              isUploading={isUploading}
              pendingUploads={[{ id: "upload-1", label: "notes.txt" }]}
            />
            <button type="button" data-testid="finish-uploads" onClick={() => setIsUploading(false)}>
              Finish uploads
            </button>
          </>
        </AppRuntimeContext.Provider>
      );
    }

    await act(async () => {
      root?.render(<Harness />);
    });

    const sendButton = container?.querySelector(".send-btn") as HTMLButtonElement | null;
    expect(sendButton).not.toBeNull();
    expect(sendButton?.disabled).toBe(false);
    expect(sendButton?.className).toContain("send-btn-pending-uploads");

    const attachMenuButton = container?.querySelector("[data-testid=\"attach-files-menu\"]") as HTMLButtonElement | null;
    expect(attachMenuButton?.disabled).toBe(false);
    expect(attachFilesMenuPropsMock).toHaveBeenCalled();
    expect(attachFilesMenuPropsMock.mock.calls.at(-1)?.[0]).not.toHaveProperty("isBusy");

    await act(async () => {
      click(sendButton);
    });

    expect(onSubmit).not.toHaveBeenCalled();
    expect(container?.querySelector(".send-btn-dots")).not.toBeNull();

    await act(async () => {
      click(container?.querySelector("[data-testid=\"finish-uploads\"]") ?? null);
      await Promise.resolve();
    });

    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("renders an animated spinner without text when submitting", async () => {
    await act(async () => {
      root?.render(
        <AppRuntimeContext.Provider value={createAppRuntimeValue() as any}>
          <ChatInput
            value="Ready to send"
            onChange={() => {}}
            onSubmit={() => {}}
            isSubmitting={true}
            attachments={[]}
            onRemoveAttachment={() => {}}
            onAttachFiles={() => {}}
            isUploading={false}
          />
        </AppRuntimeContext.Provider>
      );
    });

    const sendButton = container?.querySelector(".send-btn") as HTMLButtonElement | null;
    expect(sendButton).not.toBeNull();
    expect(sendButton?.disabled).toBe(true);
    expect(sendButton?.className).toContain("send-btn-submitting");
    expect(sendButton?.textContent).toBe("");
    expect(sendButton?.querySelector(".spin")).not.toBeNull();
    expect(sendButton?.getAttribute("aria-label")).toBe("Sending message...");
  });

  it("shows a workflow reminder when Long Horizon is selected", async () => {
    await act(async () => {
      root?.render(
        <AppRuntimeContext.Provider value={createAppRuntimeValue() as any}>
          <ChatInput
            value=""
            onChange={() => {}}
            onSubmit={() => {}}
            isSubmitting={false}
            attachments={[]}
            onRemoveAttachment={() => {}}
            onAttachFiles={() => {}}
            isUploading={false}
            workflowConfig={{
              type: "long_horizon",
              workerCount: 3,
              reviewRounds: 0,
              modelAllocations: [],
              tokenBudget: 100_000
            }}
          />
        </AppRuntimeContext.Provider>
      );
    });

    expect(container?.textContent).toContain("Long Horizon selected");
  });

  it("shows a workflow reminder when Agent Swarm is selected", async () => {
    await act(async () => {
      root?.render(
        <AppRuntimeContext.Provider value={createAppRuntimeValue() as any}>
          <ChatInput
            value=""
            onChange={() => {}}
            onSubmit={() => {}}
            isSubmitting={false}
            attachments={[]}
            onRemoveAttachment={() => {}}
            onAttachFiles={() => {}}
            isUploading={false}
            workflowConfig={{
              type: "agent_swarm",
              workerCount: 3,
              reviewRounds: 0,
              modelAllocations: [],
              tokenBudget: null
            }}
          />
        </AppRuntimeContext.Provider>
      );
    });

    expect(container?.textContent).toContain("Agent Swarm selected");
  });

  it("shows a workflow reminder when Quality control is selected", async () => {
    await act(async () => {
      root?.render(
        <AppRuntimeContext.Provider value={createAppRuntimeValue() as any}>
          <ChatInput
            value=""
            onChange={() => {}}
            onSubmit={() => {}}
            isSubmitting={false}
            attachments={[]}
            onRemoveAttachment={() => {}}
            onAttachFiles={() => {}}
            isUploading={false}
            workflowConfig={{
              type: "quality_control",
              workerCount: 3,
              reviewRounds: 0,
              modelAllocations: [],
              tokenBudget: null
            }}
          />
        </AppRuntimeContext.Provider>
      );
    });

    expect(container?.textContent).toContain("Quality control selected");
  });

  it("does not force textarea layout when the value changes", async () => {
    const scrollHeightDescriptor = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "scrollHeight");
    let scrollHeightReads = 0;
    Object.defineProperty(HTMLTextAreaElement.prototype, "scrollHeight", {
      configurable: true,
      get: () => {
        scrollHeightReads += 1;
        return 64;
      }
    });

    try {
      await act(async () => {
        root?.render(
          <AppRuntimeContext.Provider value={createAppRuntimeValue() as any}>
            <ChatInput
              value="First"
              onChange={() => {}}
              onSubmit={() => {}}
              isSubmitting={false}
              attachments={[]}
              onRemoveAttachment={() => {}}
              onAttachFiles={() => {}}
              isUploading={false}
            />
          </AppRuntimeContext.Provider>
        );
      });

      await act(async () => {
        root?.render(
          <AppRuntimeContext.Provider value={createAppRuntimeValue() as any}>
            <ChatInput
              value="First\nSecond"
              onChange={() => {}}
              onSubmit={() => {}}
              isSubmitting={false}
              attachments={[]}
              onRemoveAttachment={() => {}}
              onAttachFiles={() => {}}
              isUploading={false}
            />
          </AppRuntimeContext.Provider>
        );
      });

      expect(scrollHeightReads).toBe(0);
    } finally {
      if (scrollHeightDescriptor) {
        Object.defineProperty(HTMLTextAreaElement.prototype, "scrollHeight", scrollHeightDescriptor);
      } else {
        delete (HTMLTextAreaElement.prototype as { scrollHeight?: number }).scrollHeight;
      }
    }
  });

  it("toggles force include for individual attachments", async () => {
    const onToggleAttachmentForceInclude = vi.fn();

    await act(async () => {
      root?.render(
        <AppRuntimeContext.Provider value={createAppRuntimeValue() as any}>
          <ChatInput
            value=""
            onChange={() => {}}
            onSubmit={() => {}}
            isSubmitting={false}
            attachments={[{
              id: "attachment-1",
              kind: "file",
              label: "notes.txt",
              content: "inputs/notes.txt",
              relativePath: "inputs/notes.txt"
            }]}
            onRemoveAttachment={() => {}}
            onToggleAttachmentForceInclude={onToggleAttachmentForceInclude}
            onAttachFiles={() => {}}
            isUploading={false}
          />
        </AppRuntimeContext.Provider>
      );
    });

    const toggle = container?.querySelector("[aria-label=\"Force include notes.txt\"]") ?? null;
    expect(toggle).not.toBeNull();

    await act(async () => {
      click(toggle);
    });

    expect(onToggleAttachmentForceInclude).toHaveBeenCalledWith("attachment-1");
  });

  it("renders attached files with dedicated aligned controls", async () => {
    const onRemoveAttachment = vi.fn();
    const onToggleAttachmentForceInclude = vi.fn();

    await act(async () => {
      root?.render(
        <AppRuntimeContext.Provider value={createAppRuntimeValue() as any}>
          <ChatInput
            value=""
            onChange={() => {}}
            onSubmit={() => {}}
            isSubmitting={false}
            attachments={[{
              id: "attachment-1",
              kind: "file",
              label: "tetris-trainer-suite (1).zip",
              content: "inputs/tetris-trainer-suite (1).zip",
              relativePath: "inputs/tetris-trainer-suite (1).zip"
            }]}
            onRemoveAttachment={onRemoveAttachment}
            onToggleAttachmentForceInclude={onToggleAttachmentForceInclude}
            onAttachFiles={() => {}}
            isUploading={false}
          />
        </AppRuntimeContext.Provider>
      );
    });

    const chip = container?.querySelector(".attachment-chip") ?? null;
    const label = container?.querySelector(".attachment-chip-label") as HTMLElement | null;
    const forceIncludeButton = container?.querySelector(".attachment-force-include-btn") as HTMLButtonElement | null;
    const removeButton = container?.querySelector(".attachment-chip-remove-btn") as HTMLButtonElement | null;

    expect(chip).not.toBeNull();
    expect(label?.textContent).toBe("tetris-trainer-suite (1).zip");
    expect(label?.getAttribute("title")).toBe("tetris-trainer-suite (1).zip");
    expect(forceIncludeButton?.getAttribute("aria-label")).toBe("Force include tetris-trainer-suite (1).zip");
    expect(removeButton?.getAttribute("aria-label")).toBe("Remove tetris-trainer-suite (1).zip");

    await act(async () => {
      click(removeButton);
    });

    expect(onRemoveAttachment).toHaveBeenCalledWith("attachment-1");
  });

  it("resets the text and every attachment from the attachment list", async () => {
    const onChange = vi.fn();
    const onRemoveAttachment = vi.fn();

    await act(async () => {
      root?.render(
        <AppRuntimeContext.Provider value={createAppRuntimeValue() as any}>
          <ChatInput
            value="Keep this prompt"
            onChange={onChange}
            onSubmit={() => {}}
            isSubmitting={false}
            attachments={[
              {
                id: "attachment-1",
                kind: "file",
                label: "notes.txt",
                content: "inputs/notes.txt"
              },
              {
                id: "attachment-2",
                kind: "file",
                label: "brief.pdf",
                content: "inputs/brief.pdf"
              }
            ]}
            onRemoveAttachment={onRemoveAttachment}
            onAttachFiles={() => {}}
            isUploading={false}
          />
        </AppRuntimeContext.Provider>
      );
    });

    const resetButton = Array.from(container?.querySelectorAll("button") ?? [])
      .find((button) => button.textContent === "Reset input") ?? null;
    expect(resetButton).not.toBeNull();

    await act(async () => {
      click(resetButton);
    });

    expect(onChange).toHaveBeenCalledWith("");
    expect(onRemoveAttachment).toHaveBeenCalledTimes(2);
    expect(onRemoveAttachment).toHaveBeenNthCalledWith(1, "attachment-1");
    expect(onRemoveAttachment).toHaveBeenNthCalledWith(2, "attachment-2");

    await act(async () => {
      root?.render(
        <AppRuntimeContext.Provider value={createAppRuntimeValue() as any}>
          <ChatInput
            value="Keep this prompt"
            onChange={onChange}
            onSubmit={() => {}}
            isSubmitting={false}
            attachments={[]}
            onRemoveAttachment={onRemoveAttachment}
            onAttachFiles={() => {}}
            isUploading={false}
          />
        </AppRuntimeContext.Provider>
      );
    });

    expect(Array.from(container?.querySelectorAll("button") ?? [])
      .some((button) => button.textContent === "Reset input")).toBe(false);
  });

  it("forwards popoverPlacement to chat controls", async () => {
    attachFilesMenuPropsMock.mockClear();
    await act(async () => {
      root?.render(
        <AppRuntimeContext.Provider value={createAppRuntimeValue() as any}>
          <ChatInput
            value=""
            onChange={() => {}}
            onSubmit={() => {}}
            isSubmitting={false}
            attachments={[]}
            onRemoveAttachment={() => {}}
            onAttachFiles={() => {}}
            isUploading={false}
            popoverPlacement="bottom"
          />
        </AppRuntimeContext.Provider>
      );
    });

    expect(attachFilesMenuPropsMock).toHaveBeenCalledWith(
      expect.objectContaining({ popoverPlacement: "bottom" })
    );
  });
});

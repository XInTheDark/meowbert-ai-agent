/** @vitest-environment jsdom */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GoogleWorkspaceAttachmentModeDialog } from "./GoogleWorkspaceAttachmentModeDialog";

describe("GoogleWorkspaceAttachmentModeDialog", () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  it("defaults to Office conversion and exposes direct editing", async () => {
    const onChoose = vi.fn();
    await act(async () => {
      root.render(
        <GoogleWorkspaceAttachmentModeDialog
          fileCount={1}
          fileMode="copy"
          canAttachDirectly
          onChoose={onChoose}
          onCancel={vi.fn()}
        />
      );
    });

    const buttons = Array.from(document.body.querySelectorAll<HTMLButtonElement>(".google-workspace-mode-option"));
    expect(buttons[0]?.textContent).toContain("Convert to Office files");
    expect(document.activeElement).toBe(buttons[0]);
    expect(buttons[1]?.textContent).toContain("Experimental");
    await act(async () => buttons[1]?.click());
    expect(onChoose).toHaveBeenCalledWith("direct");
  });

  it("disables direct editing for read-only Google connections", async () => {
    await act(async () => {
      root.render(
        <GoogleWorkspaceAttachmentModeDialog
          fileCount={2}
          fileMode="live_sync"
          canAttachDirectly={false}
          onChoose={vi.fn()}
          onCancel={vi.fn()}
        />
      );
    });
    const buttons = document.body.querySelectorAll<HTMLButtonElement>(".google-workspace-mode-option");
    expect(buttons[1]?.disabled).toBe(true);
    expect(buttons[1]?.textContent).toContain("Reconnect Google Drive");
  });
});

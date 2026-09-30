/** @vitest-environment jsdom */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PersistentShellSessionSummary } from "../../../lib/types";
import { PersistentShellsPanel } from "./PersistentShellsPanel";

const activeShell: PersistentShellSessionSummary = {
  id: "shell-1",
  status: "running",
  command: "npm run dev",
  workingDir: "/workspace",
  startedAt: "2026-09-03T10:00:00.000Z",
  updatedAt: "2026-09-03T10:01:00.000Z",
  output: "Listening"
};

const completedShell: PersistentShellSessionSummary = {
  ...activeShell,
  id: "shell-2",
  status: "completed",
  command: "npm run build"
};

describe("PersistentShellsPanel", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("terminates an individual active shell and all active shells", async () => {
    const onTerminate = vi.fn(async () => undefined);
    const onTerminateAll = vi.fn(async () => undefined);
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);

    await act(async () => {
      root.render(
        <PersistentShellsPanel
          title="Background shells"
          description="Shell output"
          items={[activeShell, completedShell]}
          isLoading={false}
          error={null}
          onRefresh={vi.fn()}
          onTerminate={onTerminate}
          onTerminateAll={onTerminateAll}
          emptyMessage="No shells"
        />
      );
    });

    expect(container.querySelectorAll(".persistent-shell-terminate-btn")).toHaveLength(1);
    expect(container.textContent).toContain("Terminate all shells");

    await act(async () => {
      container.querySelector<HTMLButtonElement>(".persistent-shell-terminate-btn")?.click();
      await Promise.resolve();
    });
    expect(onTerminate).toHaveBeenCalledWith("shell-1");

    await act(async () => {
      container.querySelector<HTMLButtonElement>(".persistent-shells-terminate-all-btn")?.click();
      await Promise.resolve();
    });
    expect(confirm).toHaveBeenCalledWith("Terminate all active shell sessions?");
    expect(onTerminateAll).toHaveBeenCalledTimes(1);

    confirm.mockRestore();
  });

  it("renders expiration timestamp when present", async () => {
    const shellWithExpiry: PersistentShellSessionSummary = {
      ...activeShell,
      expiresAt: "2026-09-03T22:00:00.000Z"
    };

    await act(async () => {
      root.render(
        <PersistentShellsPanel
          title="Background shells"
          description="Shell output"
          items={[shellWithExpiry]}
          isLoading={false}
          error={null}
          onRefresh={vi.fn()}
          onTerminate={vi.fn()}
          onTerminateAll={vi.fn()}
          emptyMessage="No shells"
        />
      );
    });

    expect(container.textContent).toContain("Expires");
  });
});

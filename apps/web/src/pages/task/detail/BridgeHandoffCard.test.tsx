/** @vitest-environment jsdom */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BridgeHandoffInfo } from "@meowbert/shared";

const state = vi.hoisted(() => ({
  getTaskBridgeHandoff: vi.fn(),
  getBridgeStatus: vi.fn(),
  parkBridgeRun: vi.fn(),
  listener: null as null | ((sessions: BridgeHandoffInfo[]) => void)
}));

vi.mock("../../../desktop/platform", () => ({
  platform: {
    capabilities: { isDesktop: true },
    getTaskBridgeHandoff: state.getTaskBridgeHandoff,
    getBridgeStatus: state.getBridgeStatus,
    parkBridgeRun: state.parkBridgeRun,
    onBridgeSessionsChanged: (cb: (sessions: BridgeHandoffInfo[]) => void) => {
      state.listener = cb;
      return () => { state.listener = null; };
    }
  }
}));

import { BridgeHandoffCard } from "./BridgeHandoffCard";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function sampleHandoff(overrides: Partial<BridgeHandoffInfo> = {}): BridgeHandoffInfo {
  return {
    runId: "run-1",
    taskId: "task-1",
    sessionCode: "mb_1234abcd",
    mode: "host",
    status: "waiting_for_start",
    prompt: 'Call `meowbert_start` with `session_code: "mb_1234abcd"`.',
    createdAt: "2026-11-21T00:00:00Z",
    connectedAt: null,
    lastActivityAt: null,
    ...overrides
  };
}

describe("BridgeHandoffCard", () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;

  afterEach(() => {
    act(() => root?.unmount());
    container?.remove();
    vi.clearAllMocks();
  });

  it("shows waiting handoff prompt, updates on live connection, and parks on Disconnect", async () => {
    const waiting = sampleHandoff();
    state.getTaskBridgeHandoff.mockResolvedValue(waiting);
    state.parkBridgeRun.mockResolvedValue(true);

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root!.render(<BridgeHandoffCard taskId="task-1" />);
    });

    expect(container.textContent).toContain("Waiting for external harness");
    expect(container.textContent).toContain("mb_1234abcd");
    expect(container.querySelector("pre")?.textContent).toContain("meowbert_start");

    act(() => {
      state.listener?.([sampleHandoff({ status: "connected", connectedAt: "2026-11-21T00:01:00Z" })]);
    });
    expect(container.textContent).toContain("Connected via Bridge");
    expect(container.querySelector("pre")).toBeNull();

    const disconnectBtn = [...container.querySelectorAll("button")].find((btn) => btn.textContent?.includes("Disconnect"))!;
    await act(async () => { disconnectBtn.click(); });
    expect(state.parkBridgeRun).toHaveBeenCalledWith("run-1");

    act(() => { state.listener?.([]); });
    expect(container.textContent).toBe("");
  });
});

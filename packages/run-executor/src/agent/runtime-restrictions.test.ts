import { describe, expect, it } from "vitest";
import type { TaskExecutionJob } from "@meowbert/shared";
import { resolvePersistentRuntimeEnabled, resolveRunToolOptions } from "./runtime.js";
import type { TaskSnapshot } from "./types.js";

function snapshotWith(task: { read_only: boolean; network_disabled: boolean }): TaskSnapshot {
  return {
    task,
    messages: [{ role: "user", content_json: { tools: { webSearch: true } }, message_metadata_json: {} }],
    interactive_canvas: null
  } as unknown as TaskSnapshot;
}

describe("task restrictions at run time", () => {
  const job = { mode: "default", toolOptionsOverride: undefined } as unknown as TaskExecutionJob;

  it("turns web search off for a no-network task even when the message asked for it", () => {
    expect(resolveRunToolOptions(snapshotWith({ read_only: false, network_disabled: false }), job, false).webSearch).toBe(true);
    expect(resolveRunToolOptions(snapshotWith({ read_only: false, network_disabled: true }), job, false).webSearch).toBe(false);
  });

  it("refuses persistent shells to read-only and no-network tasks", () => {
    const payload = {};

    expect(resolvePersistentRuntimeEnabled({ read_only: false, network_disabled: false } as TaskSnapshot["task"], payload)).toBe(true);
    expect(resolvePersistentRuntimeEnabled({ read_only: true, network_disabled: false } as TaskSnapshot["task"], payload)).toBe(false);
    expect(resolvePersistentRuntimeEnabled({ read_only: false, network_disabled: true } as TaskSnapshot["task"], payload)).toBe(false);
  });
});

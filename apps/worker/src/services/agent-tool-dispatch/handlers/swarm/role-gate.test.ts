import { describe, expect, it } from "vitest";
import { DEFAULT_AGENT_SWARM_ADVANCED_SETTINGS, normalizeAgentSwarmSettings } from "@meowbert/shared";
import { createSwarmActivity } from "../../../agent-swarm/auto-notes.js";
import type { SwarmRunContext } from "../../../agent-swarm/config.js";
import type { SwarmLaneRow } from "../../../agent-swarm/lane-store.js";
import { checkSwarmToolRole } from "./role-gate.js";
import { isLastToolCallOfResponse } from "./fork-call.js";
import { withUndirectedLane } from "./diverge.js";

function context(
  lane: Partial<SwarmLaneRow> | null,
  maxDepth = DEFAULT_AGENT_SWARM_ADVANCED_SETTINGS.maxDepth,
  withinDiverge = lane?.kind === "diverge"
): SwarmRunContext {
  return {
    swarmTaskId: "root",
    settings: normalizeAgentSwarmSettings({ leaderAgentId: "leader", advanced: { maxDepth } }),
    lane: lane ? { task_id: "lane", parent_task_id: "root", depth: 1, kind: "split", ...lane } as SwarmLaneRow : null,
    ancestorLaneIds: [],
    withinDiverge,
    forcedSubmitReason: null,
    activity: createSwarmActivity()
  };
}

describe("swarm tool roles", () => {
  it("lets the leader split but not share or submit", () => {
    const leader = context(null);
    expect(checkSwarmToolRole("split", leader)).toBeNull();
    expect(checkSwarmToolRole("share", leader)).toMatch(/Only lanes/);
    expect(checkSwarmToolRole("submit", leader)).toMatch(/Only lanes/);
  });

  it("stops splitting at the maximum depth and never lets a Check lane split or share", () => {
    expect(checkSwarmToolRole("split", context({ depth: 1 }, 2))).toBeNull();
    expect(checkSwarmToolRole("split", context({ depth: 2 }, 2))).toMatch(/Maximum depth/);
    expect(checkSwarmToolRole("split", context({ kind: "check" }))).toMatch(/Check lanes cannot split/);
    expect(checkSwarmToolRole("share", context({ kind: "check" }))).toMatch(/do not share/);
    expect(checkSwarmToolRole("submit", context({ kind: "check" }))).toBeNull();
  });

  it("lets the leader and split lanes diverge, but never a diverge answer or anything inside one", () => {
    expect(checkSwarmToolRole("diverge", context(null))).toBeNull();
    expect(checkSwarmToolRole("diverge", context({ depth: 1 }))).toBeNull();
    expect(checkSwarmToolRole("diverge", context({ kind: "diverge" }))).toMatch(/cannot diverge again/);
    expect(checkSwarmToolRole("diverge", context({ kind: "split", depth: 2 }, 3, true))).toMatch(/cannot diverge again/);
    expect(checkSwarmToolRole("split", context({ kind: "diverge" }))).toBeNull();
    expect(checkSwarmToolRole("diverge", context({ kind: "check" }))).toMatch(/Check lanes cannot diverge/);
  });

  it("keeps Check lanes to submitting", () => {
    for (const tool of ["check", "steer", "stop", "resume"]) {
      expect(checkSwarmToolRole(tool, context({ kind: "check" }))).toMatch(/no lanes of their own/);
      expect(checkSwarmToolRole(tool, context(null))).toBeNull();
    }
  });

  it("refuses swarm tools outside a swarm", () => {
    expect(checkSwarmToolRole("split", null)).toMatch(/only available in an Agent Swarm/);
  });
});

describe("split position", () => {
  const call = (callId: string) => ({ type: "function_call", call_id: callId, name: "x", arguments: "{}" });

  it("accepts a split that is the response's last tool call, after earlier outputs", () => {
    const items = [call("read"), call("split"), { type: "function_call_output", call_id: "read", output: "ok" }];
    expect(isLastToolCallOfResponse(items as never, "split")).toBe(true);
  });

  it("rejects a split followed by another call", () => {
    expect(isLastToolCallOfResponse([call("split"), call("read")] as never, "split")).toBe(false);
  });
});

describe("diverge lanes", () => {
  it("adds one undirected lane only when every lane was given an angle", () => {
    const undirected = { title: "Undirected", direction: null };
    expect(withUndirectedLane([{ title: "Value", direction: "price on value" }], undirected)).toHaveLength(2);
    expect(withUndirectedLane([{ title: "Value", direction: "price on value" }, { title: "Open", direction: null }], undirected))
      .toHaveLength(2);
  });
});

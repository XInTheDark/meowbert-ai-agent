import { describe, expect, it, vi } from "vitest";
import { normalizeAgentSwarmSettings } from "@meowbert/shared";
import type { ResponseFunctionToolCall } from "openai/resources/responses/responses";
import { buildSwarmFunctionTools } from "../../agent-tools/swarm.js";
import type { ToolDispatchContext } from "../../agent-tool-dispatch/types.js";
import type { SwarmBackend } from "../backend.js";
import { handleShare } from "./share.js";

function setup() {
  const backend = { shareNote: vi.fn(async () => {}) } satisfies Partial<SwarmBackend>;
  const ctx = {
    taskId: "lane-1",
    swarm: {
      run: {
        swarmTaskId: "root",
        settings: normalizeAgentSwarmSettings({}),
        lane: { task_id: "lane-1", swarm_task_id: "root", parent_task_id: "root", depth: 1, kind: "split" }
      }
    }
  } as unknown as ToolDispatchContext;
  return { backend, ctx };
}

const call = (args: object) => ({ name: "share", arguments: JSON.stringify(args) }) as ResponseFunctionToolCall;

describe("share tool scope contract", () => {
  it("requires explicit scope and offers nullable wake_parent on share", () => {
    const share = buildSwarmFunctionTools("all").find((tool) => tool.name === "share");
    if (!share) throw new Error("share tool missing");
    expect(share.strict).toBe(true);
    const params = share.parameters as Record<string, any>;
    expect(params.required.sort()).toEqual(["scope", "text", "wake_parent"]);
    expect(params.properties.scope.type).toBe("string");
    expect(params.properties.scope.enum).toEqual(["siblings", "parent", "all"]);
    expect(params.properties.wake_parent.type).toEqual(["boolean", "null"]);
  });

  it.each(["siblings", "parent", "all"] as const)("forwards scope=%s with wake_parent defaulting to false", async (scope) => {
    const { backend, ctx } = setup();
    const result = await handleShare(backend as unknown as SwarmBackend, call({ text: "Schema changed.", scope, wake_parent: null }), ctx);
    expect(result).toEqual({ output: { shared: true, scope, wake_parent: false } });
    expect(backend.shareNote).toHaveBeenCalledWith(expect.anything(), { text: "Schema changed.", scope, wakeParent: false });
  });

  it.each(["parent", "all"] as const)("allows wake_parent=true when scope=%s", async (scope) => {
    const { backend, ctx } = setup();
    const result = await handleShare(backend as unknown as SwarmBackend, call({ text: "Blocked on API key.", scope, wake_parent: true }), ctx);
    expect(result).toEqual({ output: { shared: true, scope, wake_parent: true } });
    expect(backend.shareNote).toHaveBeenCalledWith(expect.anything(), { text: "Blocked on API key.", scope, wakeParent: true });
  });

  it.each([
    { text: "Missing scope" },
    { text: "Null scope", scope: null },
    { text: "Bad scope", scope: "everyone" },
    { text: "Siblings cannot wake parent", scope: "siblings", wake_parent: true }
  ])("rejects invalid share arguments %j", async (args) => {
    const { backend, ctx } = setup();
    const result = await handleShare(backend as unknown as SwarmBackend, call(args), ctx);
    expect(result).toHaveProperty("output.error");
    expect(backend.shareNote).not.toHaveBeenCalled();
  });
});

import { describe, expect, it } from "vitest";
import type { FunctionTool, Tool } from "openai/resources/responses/responses";
import { buildResponseTools } from "../agent-tools/index.js";
import { buildCodeModeToolSet } from "./code-mode-tools.js";

const options = { webSearch: true, memorySearch: true, scheduleTask: false, subtasks: true, computerUse: false, enabledSkills: [], enabledSources: [] };

function toolName(tool: Tool): string {
  return "name" in tool && typeof tool.name === "string" ? tool.name : tool.type;
}

describe("buildCodeModeToolSet", () => {
  it("keeps turn-ending, context and media tools direct and moves the rest behind exec", () => {
    const tools = buildResponseTools(options, [], { allowWaitTool: true, contextManagementVersion: "v2" });
    const { responseTools, nestedTools } = buildCodeModeToolSet(tools, 600);
    const directNames = responseTools.map(toolName);
    const nestedNames = nestedTools.map((tool) => tool.name);

    expect(directNames).toEqual(expect.arrayContaining(["final_response", "wait", "new_context", "view_image", "enable_skill", "web_search", "exec"]));
    expect(nestedNames).toEqual(expect.arrayContaining(["run_shell", "memory_search", "spawn_subagent"]));
    expect(directNames.filter((name) => nestedNames.includes(name))).toEqual([]);
    expect(responseTools.length + nestedTools.length).toBe(tools.length + 1);
  });

  it("offers exec with a strict schema that lists every nested tool", () => {
    const tools = buildResponseTools(options, [], {});
    const { responseTools, nestedTools } = buildCodeModeToolSet(tools, 600);
    const exec = responseTools.find((tool): tool is FunctionTool => tool.type === "function" && tool.name === "exec")!;
    const parameters = exec.parameters as { properties: Record<string, unknown>; required: string[]; additionalProperties: boolean };

    expect(exec.strict).toBe(true);
    expect(parameters.required.sort()).toEqual(Object.keys(parameters.properties).sort());
    expect(parameters.additionalProperties).toBe(false);
    for (const tool of nestedTools) {
      expect(exec.description).toContain(`tools.${tool.name}(`);
    }
  });

  it("leaves the tool list alone when nothing can move behind exec", () => {
    const tools = buildResponseTools(options, [], { contextManagementVersion: "v2", contextRecoveryPhase: "needs_reset" });

    expect(buildCodeModeToolSet(tools, 600)).toEqual({ responseTools: tools, nestedTools: [] });
  });
});

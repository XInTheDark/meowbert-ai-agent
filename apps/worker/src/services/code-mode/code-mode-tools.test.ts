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
    expect(responseTools.length + nestedTools.length).toBe(tools.length + 2);
    expect(directNames).toContain("search_tools");
  });

  it("offers exec and search_tools with strict schemas", () => {
    const { responseTools } = buildCodeModeToolSet(buildResponseTools(options, [], { allowLiveSyncTools: true }), 600);
    for (const name of ["exec", "search_tools"]) {
      const tool = responseTools.find((candidate): candidate is FunctionTool => candidate.type === "function" && candidate.name === name)!;
      const parameters = tool.parameters as { properties: Record<string, unknown>; required: string[]; additionalProperties: boolean };
      expect(tool.strict).toBe(true);
      expect([...parameters.required].sort()).toEqual(Object.keys(parameters.properties).sort());
      expect(parameters.additionalProperties).toBe(false);
    }
  });

  it("documents warm tools in full and lists the others by group, one group per skill", () => {
    const skillTool: FunctionTool = {
      type: "function",
      name: "google_drive__upload_file",
      description: "Upload a file to Google Drive. Supports folders.",
      strict: true,
      parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"], additionalProperties: false }
    };
    const tools = buildResponseTools({ ...options, scheduleTask: true }, [skillTool], { allowLiveSyncTools: true });
    const { responseTools, nestedTools } = buildCodeModeToolSet(tools, 600);
    const exec = responseTools.find((tool): tool is FunctionTool => tool.type === "function" && tool.name === "exec")!;

    expect(nestedTools.map((tool) => tool.name)).toEqual(expect.arrayContaining(["run_shell", "list_live_sync_files", skillTool.name]));
    expect(exec.description).toContain("tools.run_shell(args:");
    expect(exec.description).toContain("- google_drive: upload_file");
    expect(exec.description).toContain("- live_sync: list_live_sync_files, get_live_sync_status, pull_live_sync_file, push_live_sync_file");
    expect(exec.description).not.toContain("tools.google_drive__upload_file(");
    expect(exec.description).not.toContain("tools.list_live_sync_files(");
    expect(exec.description).toContain("- subagents: spawn_subagent, send_subagent_message");
    expect(exec.description).not.toContain("tools.spawn_subagent(");
  });

  it("skips search_tools when every nested tool is warm", () => {
    const runShell = buildResponseTools(options, [], {}).filter((tool) => toolName(tool) === "run_shell");

    expect(buildCodeModeToolSet(runShell, 600).responseTools.map(toolName)).toEqual(["exec"]);
  });

  it("leaves the tool list alone when nothing can move behind exec", () => {
    const tools = buildResponseTools(options, [], { contextManagementVersion: "v2", contextRecoveryPhase: "needs_reset" });

    expect(buildCodeModeToolSet(tools, 600)).toEqual({ responseTools: tools, nestedTools: [] });
  });
});

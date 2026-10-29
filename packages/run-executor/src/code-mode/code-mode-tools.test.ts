import { describe, expect, it } from "vitest";
import type { FunctionTool, Tool } from "openai/resources/responses/responses";
import { buildResponseTools } from "../agent-tools/index.js";
import { buildCodeModeToolsPrompt } from "./code-mode-prompt.js";
import { buildCodeModeToolSet } from "./code-mode-tools.js";

const options = { webSearch: true, memorySearch: true, scheduleTask: false, subtasks: true, computerUse: false, enabledSkills: [], enabledSources: [] };

function toolName(tool: Tool): string {
  return "name" in tool && typeof tool.name === "string" ? tool.name : tool.type;
}

describe("buildCodeModeToolSet", () => {
  it("keeps turn-ending and context tools direct and moves the rest behind exec", () => {
    const tools = buildResponseTools(options, [], { allowWaitTool: true, contextManagementVersion: "v2" });
    const { responseTools, nestedTools } = buildCodeModeToolSet(tools, 600);
    const directNames = responseTools.map(toolName);
    const nestedNames = nestedTools.map((tool) => tool.name);

    expect(directNames).toEqual(expect.arrayContaining(["final_response", "wait", "new_context", "notes_write_file", "enable_skill", "web_search", "exec", "update_progress"]));
    expect(nestedNames).toEqual(expect.arrayContaining(["run_shell", "memory_search", "spawn_subagent", "view_image", "view_pdf_file"]));
    // A script reads earlier outputs and replaces them without the model writing them out.
    expect(nestedNames).toEqual(expect.arrayContaining(["history_list_items", "history_read_item", "context_replace_calls"]));
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

  it("lists cold built-ins by group in exec, documents warm tools in the prompt, and leaves skill tools to their prompt update", () => {
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
    expect(exec.description).not.toContain("tools.run_shell(");
    expect(buildCodeModeToolsPrompt(nestedTools)).toContain("tools.run_shell(args:");
    expect(exec.description).not.toContain("google_drive");
    expect(exec.description).toContain("- live_sync: list_live_sync_files, get_live_sync_status, pull_live_sync_file, push_live_sync_file");
    expect(exec.description).not.toContain("tools.list_live_sync_files(");
    expect(exec.description).toContain("- subagents: spawn_subagent, send_subagent_message");
    expect(exec.description).not.toContain("tools.spawn_subagent(");
  });

  it("documents the media viewers in the prompt and leaves out the PDF viewer when the model can't take PDFs", () => {
    const toolsPrompt = (allowPdfFileTool: boolean) => buildCodeModeToolsPrompt(
      buildCodeModeToolSet(buildResponseTools(options, [], { allowPdfFileTool }), 600).nestedTools
    );

    expect(toolsPrompt(true)).toContain("tools.view_image(args:");
    expect(toolsPrompt(true)).toContain("tools.view_pdf_file(args:");
    expect(toolsPrompt(false)).toContain("tools.view_image(args:");
    expect(toolsPrompt(false)).not.toContain("view_pdf_file");
  });

  it("always offers search_tools alongside exec", () => {
    const runShell = buildResponseTools(options, [], {}).filter((tool) => toolName(tool) === "run_shell");

    expect(buildCodeModeToolSet(runShell, 600).responseTools.map(toolName)).toEqual(["exec", "search_tools"]);
  });

  it("keeps only note writes direct while a checkpoint note is due", () => {
    const tools = buildResponseTools(options, [], { contextManagementVersion: "v2", contextRecoveryPhase: "needs_note" });

    expect(buildCodeModeToolSet(tools, 600)).toEqual({ responseTools: tools, nestedTools: [] });
  });

  it("leaves the tool list alone when nothing can move behind exec", () => {
    const tools = buildResponseTools(options, [], { contextManagementVersion: "v2", contextRecoveryPhase: "needs_reset" });

    expect(buildCodeModeToolSet(tools, 600)).toEqual({ responseTools: tools, nestedTools: [] });
  });
});

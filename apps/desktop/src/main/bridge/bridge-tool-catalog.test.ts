import { describe, expect, it } from "vitest";
import type { FunctionTool } from "openai/resources/responses/responses";
import {
  buildResponseTools,
  enableSkillArgumentsSchema,
  markArtifactArgumentsSchema,
  shellSessionArgumentsSchema,
  updateProgressArgumentsSchema
} from "@meowbert/run-executor/agent-tools/index";
import { BRIDGE_CORE_PROXY_TOOLS } from "./bridge-tool-catalog";

describe("bridge-tool-catalog executor contract alignment", () => {
  it("only advertises tools actually offered by buildResponseTools and mirrors their exact parameter keys", () => {
    const responseTools = buildResponseTools(
      {
        webSearch: true,
        memorySearch: true,
        scheduleTask: false,
        subtasks: false,
        computerUse: false,
        enabledSkills: [],
        enabledSources: []
      },
      [],
      {
        allowFinalResponse: true,
        allowSendMessage: true,
        allowWaitTool: true,
        allowStopTask: true,
        allowPdfFileTool: true,
        allowPersistentShellSessions: true,
        useClaudeWebSearch: true,
        runShellMaxTimeoutSeconds: 45
      }
    );

    const byName = new Map(
      responseTools
        .filter((tool): tool is FunctionTool => tool.type === "function")
        .map((tool) => [tool.name, tool])
    );

    expect(BRIDGE_CORE_PROXY_TOOLS.some((spec) => spec.meowbertToolName === "apply_patch")).toBe(false);

    for (const spec of BRIDGE_CORE_PROXY_TOOLS) {
      const executorTool = byName.get(spec.meowbertToolName!);
      expect(executorTool, `Expected ${spec.meowbertToolName} in buildResponseTools`).toBeDefined();

      const execParams = (executorTool!.parameters ?? {}) as { properties?: Record<string, unknown>; required?: string[] };
      const mcpParams = spec.inputSchema as { properties?: Record<string, unknown>; required?: string[] };
      const mcpPropKeys = Object.keys(mcpParams.properties ?? {}).filter((key) => key !== "session_code").sort();
      const execPropKeys = Object.keys(execParams.properties ?? {}).sort();
      expect(mcpPropKeys).toEqual(execPropKeys);

      const mcpRequired = (mcpParams.required ?? []).filter((key) => key !== "session_code").sort();
      const execRequired = (execParams.required ?? []).sort();
      expect(mcpRequired).toEqual(execRequired);
    }
  });

  it("matches executor Zod validation for mark_artifact, update_progress, enable_skill, and shell_session", () => {
    const byMcpName = new Map(BRIDGE_CORE_PROXY_TOOLS.map((spec) => [spec.mcpName, spec.inputSchema]));

    expect(Object.keys((byMcpName.get("meowbert_mark_artifact") as { properties: Record<string, unknown> }).properties)).toContain("file_paths");
    expect(markArtifactArgumentsSchema.safeParse({ file_paths: ["report.md"] }).success).toBe(true);

    expect(Object.keys((byMcpName.get("meowbert_update_progress") as { properties: Record<string, unknown> }).properties)).toEqual(
      expect.arrayContaining(["session_code", "goal", "status", "steps"])
    );
    expect(updateProgressArgumentsSchema.safeParse({
      goal: "Ship bridge",
      status: "Testing schemas",
      steps: [{ title: "Verify contracts", status: "active", note: null }]
    }).success).toBe(true);

    expect(Object.keys((byMcpName.get("meowbert_enable_skill") as { properties: Record<string, unknown> }).properties)).toContain("skill");
    expect(enableSkillArgumentsSchema.safeParse({ skill: "docx" }).success).toBe(true);

    const shellSessionProps = (byMcpName.get("meowbert_shell_session") as { properties: { action: { enum: string[] } } }).properties;
    expect(shellSessionProps.action.enum).toContain("status");
    expect(shellSessionArgumentsSchema.safeParse({
      action: "list",
      session_id: null,
      command: null,
      lifetime_seconds: null,
      tail_lines: null,
      save_output_path: null,
      mode: null,
      data: null,
      cols: null,
      rows: null
    }).success).toBe(true);
  });
});

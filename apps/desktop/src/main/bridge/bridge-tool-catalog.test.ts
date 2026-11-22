import { describe, expect, it } from "vitest";
import type { FunctionTool } from "openai/resources/responses/responses";
import {
  buildResponseTools,
  enableSkillArgumentsSchema,
  updateProgressArgumentsSchema
} from "@meowbert/run-executor/agent-tools/index";
import { buildCodeModeToolSet } from "@meowbert/run-executor/code-mode/code-mode-tools";
import { execArgumentsSchema } from "@meowbert/run-executor/code-mode/exec-tool";
import { BRIDGE_CORE_PROXY_TOOLS } from "./bridge-tool-catalog";

describe("bridge-tool-catalog executor contract alignment", () => {
  it("only advertises tools a code-mode turn offers directly and mirrors their exact parameter keys", () => {
    const tools = buildResponseTools(
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
    const responseTools = buildCodeModeToolSet(tools, 45).responseTools;

    const byName = new Map(
      responseTools
        .filter((tool): tool is FunctionTool => tool.type === "function")
        .map((tool) => [tool.name, tool])
    );

    expect(BRIDGE_CORE_PROXY_TOOLS.some((spec) => spec.meowbertToolName === "apply_patch")).toBe(false);

    for (const spec of BRIDGE_CORE_PROXY_TOOLS) {
      const executorTool = byName.get(spec.meowbertToolName!);
      expect(executorTool, `Expected ${spec.meowbertToolName} among code-mode response tools`).toBeDefined();

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

  it("matches executor Zod validation for exec, update_progress, and enable_skill", () => {
    const byMcpName = new Map(BRIDGE_CORE_PROXY_TOOLS.map((spec) => [spec.mcpName, spec.inputSchema]));

    expect(Object.keys((byMcpName.get("meowbert_exec") as { properties: Record<string, unknown> }).properties)).toEqual(
      expect.arrayContaining(["session_code", "code", "timeout_seconds", "summary"])
    );
    expect(execArgumentsSchema.safeParse({ code: "return 1;", timeout_seconds: null, summary: null }).success).toBe(true);

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
  });
});

import { expect, it, vi } from "vitest";
import type { FunctionTool } from "openai/resources/responses/responses";
import type { ServerRunState } from "../run-host/bootstrap.js";
import type { RunControl } from "@meowbert/run-executor/agent/ports/run-control";
const control = {} as RunControl;
const options = { webSearch: false, memorySearch: false, scheduleTask: false, subtasks: false, computerUse: false, enabledSkills: [], enabledSources: [] };
import { buildResponseTools, TASK_TITLE_FUNCTION_TOOL } from "@meowbert/run-executor/agent-tools/index";
import { COMPACTION_TOOL_NAME, COMPACTION_OUTPUT_SCHEMA } from "@meowbert/run-executor/context-compaction/shared";
vi.mock("../../lib/config.js", async () => ({ config: { skills: { rootDir: (await import("node:path")).resolve("../../skills") } } }));
vi.mock("../runtime/sandbox.js", () => ({ workerSandboxManager: {} }));
import { createModelToolPolicy } from "./model-tool-policy.js";

function state(webSearch = false): ServerRunState {
  return { job: { executionTarget: { kind: "local", mode: "host", deviceId: "11111111-1111-4111-8111-111111111111" },
    toolOptionsOverride: { webSearch, computerUse: true, enabledSkills: [], enabledSources: [] } },
  snapshot: { shell_tool_max_timeout_ms: 600_000, messages: [], task: {}, interactive_canvas: null },
  bootstrap: { fileHost: { kind: "device", deviceId: "11111111-1111-4111-8111-111111111111" }, memoryEnabled: false,
    runtime: { compatibilityModes: [], modelType: "openai" }, liveSyncFiles: [], github: {} } } as unknown as ServerRunState;
}

it("accepts real builtin subsets and rejects altered schemas, duplicates and invented tools", async () => {
  const validate = createModelToolPolicy(state(), control, {});
  const shell = buildResponseTools(options, [], { runShellMaxTimeoutSeconds: 600 })
    .find((tool) => tool.type === "function" && tool.name === "run_shell") as FunctionTool;
  await expect(validate([shell], "turn")).resolves.toBeUndefined();
  await expect(validate([{ ...shell, description: "Lazy catalog description" }], "turn")).resolves.toBeUndefined();
  await expect(validate([{ ...shell, parameters: { type: "object" } }], "turn")).rejects.toMatchObject({ code: "invalid_request" });
  await expect(validate([shell, shell], "turn")).rejects.toMatchObject({ code: "invalid_request" });
  await expect(validate([{ ...shell, name: "read_other_users" }], "turn")).rejects.toMatchObject({ code: "invalid_request" });
});

it("does not grant a device tools from disabled host capabilities or excluded workflows", async () => {
  const validate = createModelToolPolicy(state(), control, {});
  const tools = buildResponseTools({ ...options, computerUse: true, memorySearch: true, subtasks: true }, [],
    { allowHostShell: true, allowComputerVisualTools: true, allowStartLongHorizonTask: true });
  for (const name of ["host_shell", "computer_screenshot", "memory_search", "start_long_horizon_task"]) {
    const tool = tools.find((tool) => tool.type === "function" && tool.name === name);
    expect(tool).toBeDefined();
    await expect(validate([tool!], "turn")).rejects.toMatchObject({ code: "invalid_request" });
  }
});

it("scopes auxiliary schemas to their purpose and hosted search to enabled runs", async () => {
  const validate = createModelToolPolicy(state(true), control, {});
  const compact: FunctionTool = { type: "function", name: COMPACTION_TOOL_NAME, description: "Summary", strict: true, parameters: COMPACTION_OUTPUT_SCHEMA };
  await expect(validate([TASK_TITLE_FUNCTION_TOOL], "title")).resolves.toBeUndefined();
  await expect(validate([compact], "compaction")).resolves.toBeUndefined();
  await expect(validate([TASK_TITLE_FUNCTION_TOOL], "turn")).rejects.toMatchObject({ code: "invalid_request" });
  const search = buildResponseTools({ ...options, webSearch: true }, []).find((tool) => tool.type === "web_search")!;
  await expect(validate([search], "turn")).resolves.toBeUndefined();
  await expect(validate([search], "web_search")).rejects.toMatchObject({ code: "invalid_request" });
  await expect(createModelToolPolicy(state(), control, {})([search], "turn")).rejects.toMatchObject({ code: "invalid_request" });
});

it("accepts the installed host-browser catalog only with consent and rejects forged skill schemas", async () => {
  const [{ createConnection }, { Client }, { InMemoryTransport }, { mcpToolsToFunctionTools }] = await Promise.all([
    import("@playwright/mcp"), import("@modelcontextprotocol/sdk/client/index.js"), import("@modelcontextprotocol/sdk/inMemory.js"),
    import("@meowbert/run-executor/agent/mcp-client")
  ]);
  const open = vi.fn(() => { throw new Error("A catalog query must never open Chrome."); });
  const server = await createConnection({ browser: { browserName: "chromium" } }, open);
  const client = new Client({ name: "policy-test", version: "1" });
  const [left, right] = InMemoryTransport.createLinkedPair();
  try {
    await server.connect(right); await client.connect(left);
    const catalog = await client.listTools();
    const tools = mcpToolsToFunctionTools("host-browser", catalog.tools.map((tool) => ({
      name: tool.name, description: tool.description ?? "", inputSchema: tool.inputSchema
    })));
    expect(tools.length).toBeGreaterThan(0);
    const validate = createModelToolPolicy(state(), control, { hostBrowser: true });
    await expect(validate(tools, "turn")).resolves.toBeUndefined();
    await expect(validate([{ ...tools[0], parameters: {} }], "turn")).rejects.toMatchObject({ code: "invalid_request" });
    await expect(createModelToolPolicy(state(), control, {})([tools[0]], "turn")).rejects.toMatchObject({ code: "invalid_request" });
    expect(open).not.toHaveBeenCalled();
  } finally { await client.close(); await server.close(); }
});

import { describe, expect, it } from "vitest";
import { buildResponseTools, waitArgumentsSchema } from "./index.js";

const session = { session_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", on_output: true, on_exit: false };

describe("wait tool contract", () => {
  it("accepts bounded time-only and combined shell conditions", () => {
    expect(waitArgumentsSchema.safeParse({ seconds: 1, shell_sessions: null, response: null, notify: null }).success).toBe(true);
    expect(waitArgumentsSchema.safeParse({ seconds: 3600, shell_sessions: [session, { ...session, on_output: false, on_exit: true }] }).success).toBe(true);
    expect(waitArgumentsSchema.safeParse({ seconds: 604800, response: "Check again later" }).success).toBe(true);
  });

  it.each([
    {}, { seconds: null }, { seconds: 0 }, { seconds: 604801 }, { seconds: Infinity }, { seconds: 1.5 },
    { seconds: 10, shell_sessions: [] },
    { seconds: 10, shell_sessions: [{ ...session, session_id: "bad-id" }] },
    { seconds: 10, shell_sessions: [{ ...session, on_output: false }] },
    { seconds: 10, shell_sessions: Array(9).fill(session) },
    { seconds: 10, unknown_condition: true }
  ])("rejects invalid wait arguments %j", (args) => {
    expect(waitArgumentsSchema.safeParse(args).success).toBe(false);
  });

  it("exposes wait alongside final_response for normal runs with strict nullable conditions", () => {
    const tools = buildResponseTools({
      webSearch: false, memorySearch: false, scheduleTask: false, subtasks: false,
      computerUse: false, enabledSkills: [], enabledSources: []
    }, [], { allowFinalResponse: true, allowWaitTool: true });
    expect(tools.some((tool) => tool.type === "function" && tool.name === "final_response")).toBe(true);
    const wait = tools.find((tool) => tool.type === "function" && tool.name === "wait");
    expect(wait?.type).toBe("function");
    if (wait?.type !== "function") throw new Error("wait unavailable");
    expect(wait.strict).toBe(true);
    const parameters = wait.parameters as Record<string, any>;
    expect(parameters.required.sort()).toEqual(Object.keys(parameters.properties).sort());
    const items = parameters.properties.shell_sessions.items;
    expect(items.required.sort()).toEqual(Object.keys(items.properties).sort());
    expect(items.additionalProperties).toBe(false);
    expect(wait.description).toContain("whichever happens first");
  });
});

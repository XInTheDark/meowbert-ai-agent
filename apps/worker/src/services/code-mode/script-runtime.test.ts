import { describe, expect, it, vi } from "vitest";
import { runCodeModeScript } from "./script-runtime.js";

function echoTools() {
  const calls: Array<{ name: string; args: unknown }> = [];
  const callTool = vi.fn(async (name: string, args: unknown) => {
    calls.push({ name, args });
    if (name === "fail") throw new Error("tool exploded");
    return { name, args };
  });
  return { calls, callTool };
}

describe("runCodeModeScript", () => {
  it("chains dependent tool calls and returns only what the script logs and returns", async () => {
    const { calls, callTool } = echoTools();
    const result = await runCodeModeScript({
      code: `
        const first = await tools.read({ path: "a.txt" });
        const second = await tools.read({ path: first.args.path + ".bak" });
        console.log("checked", second.args.path, { ok: true });
        return { paths: [first.args.path, second.args.path] };
      `,
      toolNames: ["read"],
      callTool,
      timeoutMs: 5_000
    });

    expect(calls.map((call) => call.args)).toEqual([{ path: "a.txt" }, { path: "a.txt.bak" }]);
    expect(result).toMatchObject({ error: null, timedOut: false, result: { paths: ["a.txt", "a.txt.bak"] } });
    expect(result.logs).toBe("checked a.txt.bak {\n  \"ok\": true\n}");
  });

  it("runs tool calls one at a time even when the script starts them together", async () => {
    let running = 0;
    let maxRunning = 0;
    const result = await runCodeModeScript({
      code: "return (await Promise.all([1, 2, 3].map((n) => tools.step({ n })))).length;",
      toolNames: ["step"],
      callTool: async () => {
        running += 1;
        maxRunning = Math.max(maxRunning, running);
        await new Promise((resolve) => setTimeout(resolve, 5));
        running -= 1;
        return {};
      },
      timeoutMs: 5_000
    });

    expect(result.result).toBe(3);
    expect(maxRunning).toBe(1);
  });

  it("lets the script catch a failed tool call", async () => {
    const { callTool } = echoTools();
    const result = await runCodeModeScript({
      code: "try { await tools.fail({}); } catch (error) { return error.message; }",
      toolNames: ["fail"],
      callTool,
      timeoutMs: 5_000
    });

    expect(result).toMatchObject({ error: null, result: "tool exploded" });
  });

  it("reports uncaught errors with the logs written before them", async () => {
    const result = await runCodeModeScript({
      code: "console.log('before'); undefinedFunction();",
      toolNames: [],
      callTool: async () => ({}),
      timeoutMs: 5_000
    });

    expect(result.logs).toBe("before");
    expect(result.error).toContain("ReferenceError");
  });

  it("does not expose host functions beyond tools and console", async () => {
    const result = await runCodeModeScript({
      code: "return [typeof require, typeof process, typeof fetch, Object.isFrozen(tools)];",
      toolNames: ["read"],
      callTool: async () => ({}),
      timeoutMs: 5_000
    });

    expect(result.result).toEqual(["undefined", "undefined", "undefined", true]);
  });

  it("stops a busy loop at the deadline and keeps the runtime usable", async () => {
    const stuck = await runCodeModeScript({ code: "while (true) {}", toolNames: [], callTool: async () => ({}), timeoutMs: 200 });
    expect(stuck).toMatchObject({ timedOut: true, cancelled: false });

    const next = await runCodeModeScript({ code: "return 1 + 1;", toolNames: [], callTool: async () => ({}), timeoutMs: 5_000 });
    expect(next.result).toBe(2);
  });

  it("stops a script waiting forever and does not start calls after the deadline", async () => {
    const { calls, callTool } = echoTools();
    const result = await runCodeModeScript({
      code: "await new Promise(() => {}); await tools.read({});",
      toolNames: ["read"],
      callTool,
      timeoutMs: 200
    });

    expect(result.timedOut).toBe(true);
    expect(calls).toEqual([]);

    const next = await runCodeModeScript({ code: "return 'ok';", toolNames: [], callTool, timeoutMs: 5_000 });
    expect(next.result).toBe("ok");
  });

  it("waits for the tool call in flight before reporting a timeout", async () => {
    let finished = false;
    const result = await runCodeModeScript({
      code: "await tools.slow({}); await tools.slow({});",
      toolNames: ["slow"],
      callTool: async () => {
        await new Promise((resolve) => setTimeout(resolve, 300));
        finished = true;
        return {};
      },
      timeoutMs: 100
    });

    expect(result.timedOut).toBe(true);
    expect(finished).toBe(true);
  });

  it("stops when the run is cancelled", async () => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 50);
    const result = await runCodeModeScript({
      code: "await new Promise(() => {});",
      toolNames: [],
      callTool: async () => ({}),
      timeoutMs: 5_000,
      signal: controller.signal
    });

    expect(result).toMatchObject({ cancelled: true, timedOut: false });
  });
});

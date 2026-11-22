import { describe, expect, it } from "vitest";
import { BridgeSession } from "@meowbert/run-executor/bridge/bridge-session";
import { BridgeRegistry } from "./bridge-registry";
import { BridgeMcpServer } from "./bridge-mcp-server";

const TEST_PORT = 38471;
const TEST_URL = `http://127.0.0.1:${TEST_PORT}/mcp`;

function mcpPost(token: string | null, body: unknown, extraHeaders: Record<string, string> = {}) {
  return new Request(TEST_URL, {
    method: "POST",
    headers: {
      host: `127.0.0.1:${TEST_PORT}`,
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...extraHeaders
    },
    body: JSON.stringify(body)
  });
}

describe("BridgeMcpServer", () => {
  it("enforces bearer auth, localhost Host header, and blocks cross-origin browser requests", async () => {
    const registry = new BridgeRegistry();
    const server = new BridgeMcpServer({ registry, bearerToken: "secret-token", preferredPort: TEST_PORT });

    const noAuth = await server.handleWebRequest(mcpPost(null, { jsonrpc: "2.0", id: 1, method: "tools/list" }), TEST_PORT);
    expect(noAuth.status).toBe(401);

    const wrongAuth = await server.handleWebRequest(mcpPost("wrong", { jsonrpc: "2.0", id: 1, method: "tools/list" }), TEST_PORT);
    expect(wrongAuth.status).toBe(401);

    const withOrigin = await server.handleWebRequest(
      mcpPost("secret-token", { jsonrpc: "2.0", id: 1, method: "tools/list" }, { origin: "https://evil.example" }),
      TEST_PORT
    );
    expect(withOrigin.status).toBe(403);

    const badHost = await server.handleWebRequest(
      mcpPost("secret-token", { jsonrpc: "2.0", id: 1, method: "tools/list" }, { host: "evil.example:38471" }),
      TEST_PORT
    );
    expect(badHost.status).toBe(403);

    const getRes = await server.handleWebRequest(
      new Request(TEST_URL, { method: "GET", headers: { host: `127.0.0.1:${TEST_PORT}`, authorization: "Bearer secret-token" } }),
      TEST_PORT
    );
    expect(getRes.status).toBe(405);
  });

  it("switches between standard and compact tool surfaces and drives a full session over MCP", async () => {
    const registry = new BridgeRegistry();
    const server = new BridgeMcpServer({ registry, bearerToken: "tok_123", toolMode: "standard", preferredPort: TEST_PORT });

    const listStd = await server.handleWebRequest(mcpPost("tok_123", { jsonrpc: "2.0", id: 1, method: "tools/list" }), TEST_PORT);
    expect(listStd.status).toBe(200);
    const stdBody = await listStd.json() as { result: { tools: Array<{ name: string }> } };
    expect(stdBody.result.tools.map((t) => t.name)).toContain("meowbert_exec");
    expect(stdBody.result.tools.map((t) => t.name)).toContain("meowbert_start");

    server.reconfigure({ toolMode: "compact" });
    const listCompact = await server.handleWebRequest(mcpPost("tok_123", { jsonrpc: "2.0", id: 2, method: "tools/list" }), TEST_PORT);
    const compactBody = await listCompact.json() as { result: { tools: Array<{ name: string }> } };
    expect(compactBody.result.tools.map((t) => t.name)).toEqual([
      "meowbert_start",
      "meowbert_list_tools",
      "meowbert_call_tool"
    ]);
    server.reconfigure({ toolMode: "standard" });

    const session = new BridgeSession({ coalesceWindowMs: 0 });
    const handoff = registry.register({ runId: "run-1", taskId: "task-1", mode: "host", session });

    const req1 = {
      input: [{ role: "user", content: "Create hello.txt" }],
      tools: [
        { type: "function", name: "exec", description: "Run code", parameters: { type: "object", properties: { code: { type: "string" } }, required: ["code"] } },
        { type: "function", name: "final_response", description: "Finish", parameters: { type: "object", properties: { response: { type: "string" } }, required: ["response"] } }
      ]
    };
    const turn1Promise = session.handleModelTurn(req1);

    const startRes = await server.handleWebRequest(mcpPost("tok_123", {
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "meowbert_start", arguments: { session_code: handoff.sessionCode } }
    }), TEST_PORT);
    expect(startRes.status).toBe(200);
    const startJson = await startRes.json() as { result: { content: Array<{ text: string }> } };
    expect(startJson.result.content[0].text).toContain("Create hello.txt");

    const execPromise = server.handleWebRequest(mcpPost("tok_123", {
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: { name: "meowbert_exec", arguments: { session_code: handoff.sessionCode, code: "return 'ok';" } }
    }), TEST_PORT);
    const turn1 = await turn1Promise;
    const fc1 = turn1.output[0] as { call_id: string; name: string; arguments: string };
    expect(fc1.name).toBe("exec");
    expect(JSON.parse(fc1.arguments)).toEqual({ code: "return 'ok';" });

    const turn2Promise = session.handleModelTurn({
      ...req1,
      input: [...req1.input, fc1, { type: "function_call_output", call_id: fc1.call_id, output: "ok" }]
    });
    const execJson = await (await execPromise).json() as { result: { content: Array<{ text: string }> } };
    expect(execJson.result.content[0].text).toBe("ok");

    const finalPromise = server.handleWebRequest(mcpPost("tok_123", {
      jsonrpc: "2.0",
      id: 5,
      method: "tools/call",
      params: { name: "meowbert_final_response", arguments: { session_code: handoff.sessionCode, response: "Done!" } }
    }), TEST_PORT);
    const turn2 = await turn2Promise;
    expect((turn2.output[0] as { name: string }).name).toBe("final_response");

    session.onRunEnded({ status: "completed" });
    const finalJson = await (await finalPromise).json() as { result: { content: Array<{ text: string }>; isError?: boolean } };
    expect(finalJson.result.isError).toBe(false);
    expect(finalJson.result.content[0].text).toContain("finalized");
  });
});

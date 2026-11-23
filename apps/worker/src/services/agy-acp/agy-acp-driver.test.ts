import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BridgeSession } from "@meowbert/run-executor/bridge/index";
import { AgyAcpDriver } from "./agy-acp-driver.js";
import { ensureWorkerBridgeHost, stopWorkerBridgeHost } from "./agy-bridge-host.js";
import { decideAcpPermission, parseAgyUsageCounts } from "./agy-acp-protocol.js";
import type { HydratedAgyProfile } from "./agy-profile-dir.js";

const FAKE_ACP_SERVER_SCRIPT = `
const readline = require("node:readline");
const rl = readline.createInterface({ input: process.stdin });
let mcpServer = null;
let pendingPermission = null;
let sessionId = "s_test_1";
let stallMode = process.env.FAKE_ACP_STALL === "1";

function send(obj) {
  process.stdout.write(JSON.stringify(obj) + "\\n");
}

async function callMcpTool(name, args) {
  const headers = { "content-type": "application/json", accept: "application/json, text/event-stream" };
  for (const h of mcpServer.headers || []) headers[h.name] = h.value;
  const res = await fetch(mcpServer.url, {
    method: "POST",
    headers,
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: Math.floor(Math.random() * 100000),
      method: "tools/call",
      params: { name, arguments: args }
    })
  });
  return res.json();
}

function askPermission(toolName) {
  return new Promise((resolve) => {
    const reqId = "perm:" + toolName;
    pendingPermission = { id: reqId, resolve };
    send({
      jsonrpc: "2.0",
      id: reqId,
      method: "session/request_permission",
      params: {
        sessionId,
        toolCall: { toolCallId: "tc_" + toolName, name: toolName, status: "pending" },
        options: [
          { optionId: "allow", name: "Allow", kind: "allow_once" },
          { optionId: "deny", name: "Deny", kind: "reject_once" }
        ]
      }
    });
  });
}

rl.on("line", async (line) => {
  const msg = JSON.parse(line);
  if (pendingPermission && msg.id === pendingPermission.id) {
    const p = pendingPermission;
    pendingPermission = null;
    p.resolve(msg.result);
    return;
  }
  if (msg.method === "initialize") {
    send({ jsonrpc: "2.0", id: msg.id, result: { protocolVersion: 1 } });
  } else if (msg.method === "session/new") {
    mcpServer = msg.params.mcpServers[0];
    send({
      jsonrpc: "2.0",
      id: msg.id,
      result: {
        sessionId,
        _meta: { antigravity: { tier: { name: "Pro", id: "pro-tier" } } },
        configOptions: [
          { id: "model", options: [{ value: "gemini-3.1-pro" }] },
          { id: "thought_level", options: [{ value: "high" }] }
        ]
      }
    });
  } else if (msg.method === "session/set_config_option") {
    send({
      jsonrpc: "2.0",
      id: msg.id,
      result: {
        configOptions: [
          { id: "model", options: [{ value: "gemini-3.1-pro" }] },
          { id: "thought_level", options: [{ value: "high" }] }
        ]
      }
    });
  } else if (msg.method === "session/prompt") {
    if (stallMode) {
      return;
    }
    const text = msg.params.prompt[0].text;
    const match = /session_code:\\s*"([^"]+)"/.exec(text);
    const sessionCode = match ? match[1] : "current";
    if (sessionCode !== "current") {
      throw new Error("Expected static session_code: current for cache stability");
    }
    const denied = await askPermission("bash");
    if (denied.outcome.optionId !== "deny") {
      throw new Error("Expected bash tool to be denied");
    }
    const allowed = await askPermission("mcp_meowbert-bridge_meowbert_start");
    if (allowed.outcome.optionId !== "allow") {
      throw new Error("Expected meowbert_start to be allowed");
    }
    await callMcpTool("meowbert_start", { session_code: sessionCode });
    await callMcpTool("meowbert_final_response", { session_code: sessionCode, message: "Done via ACP" });
    send({
      jsonrpc: "2.0",
      id: msg.id,
      result: {
        stopReason: "end_turn",
        usage: {
          inputTokens: 186,
          outputTokens: 28,
          cachedReadTokens: 60,
          cachedWriteTokens: 0,
          thoughtTokens: 10,
          totalTokens: 274
        }
      }
    });
  } else if (msg.method === "session/cancel") {
    // Wait for graceful shutdown or kill.
  } else if (msg.method === "session/close") {
    send({ jsonrpc: "2.0", id: msg.id, result: {} });
  }
});
`;

async function createTempProfile(): Promise<{ profile: HydratedAgyProfile; scriptPath: string; cleanupSync: ReturnType<typeof vi.fn> }> {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "meowbert-agy-test-"));
  const homeDir = path.join(rootDir, "home");
  const cwdDir = path.join(rootDir, "cwd");
  await fs.mkdir(homeDir, { recursive: true });
  await fs.mkdir(cwdDir, { recursive: true });
  const scriptPath = path.join(rootDir, "fake-acp.cjs");
  await fs.writeFile(scriptPath, FAKE_ACP_SERVER_SCRIPT, "utf8");
  const cleanupSync = vi.fn(async () => {
    await fs.rm(rootDir, { recursive: true, force: true }).catch(() => undefined);
  });
  return {
    scriptPath,
    cleanupSync,
    profile: {
      credentialId: "cred-1",
      revision: 1,
      initialOauthTokenJson: "{}",
      rootDir,
      homeDir,
      cwdDir,
      logFilePath: path.join(rootDir, "acp.log"),
      tokenPath: path.join(homeDir, "token"),
      cleanupAndSync: cleanupSync
    }
  };
}

afterEach(async () => {
  await stopWorkerBridgeHost();
  delete process.env.FAKE_ACP_STALL;
});

describe("agy-acp protocol helpers", () => {
  it("maps agy usage counts without double-counting thought tokens", () => {
    expect(parseAgyUsageCounts({
      inputTokens: 186,
      outputTokens: 28,
      cachedReadTokens: 60,
      cachedWriteTokens: 4,
      thoughtTokens: 10,
      totalTokens: 278
    })).toEqual({
      inputTokens: 250,
      cachedInputTokens: 60,
      cacheWriteInputTokens: 4,
      outputTokens: 28,
      reasoningTokens: 10
    });
  });

  it("allows only allowlisted meowbert-bridge tools for the active session", () => {
    const allowedTools = new Set(["mcp_meowbert-bridge_meowbert_exec"]);
    const ok = decideAcpPermission({
      params: {
        sessionId: "s1",
        toolCall: { name: "mcp_meowbert-bridge_meowbert_exec" },
        options: [
          { optionId: "allow", kind: "allow_once" },
          { optionId: "deny", kind: "reject_once" }
        ]
      },
      activeSessionId: "s1",
      allowedToolNames: allowedTools,
      turnCancelled: false
    });
    expect(ok.allowed).toBe(true);
    expect(ok.response).toEqual({ outcome: { outcome: "selected", optionId: "allow" } });

    const denied = decideAcpPermission({
      params: {
        sessionId: "s1",
        toolCall: { name: "bash" },
        options: [
          { optionId: "allow", kind: "allow_once" },
          { optionId: "deny", kind: "reject_once" }
        ]
      },
      activeSessionId: "s1",
      allowedToolNames: allowedTools,
      turnCancelled: false
    });
    expect(denied.allowed).toBe(false);
    expect(denied.response).toEqual({ outcome: { outcome: "selected", optionId: "deny" } });
  });
});

describe("AgyAcpDriver", () => {
  it("drives a full Bridge MCP round-trip, enforces permissions, and reports token usage", async () => {
    const bridgeHost = await ensureWorkerBridgeHost();
    const { profile, scriptPath, cleanupSync } = await createTempProfile();
    const session = new BridgeSession({ connectTimeoutMs: 10_000, idleTimeoutMs: 10_000 });
    const handoff = bridgeHost.registry.register({ runId: "run-1", taskId: "task-1", mode: "sandbox", session });
    const onUsage = vi.fn();

    const driver = new AgyAcpDriver({
      command: process.execPath,
      extraArgs: [scriptPath],
      profile,
      bridgeHost,
      bridgeSession: session,
      sessionCode: handoff.sessionCode,
      agyModel: "gemini-3.1-pro",
      agyThinkingLevel: "high",
      onUsage
    });

    const driverDone = driver.start();
    const firstTurn = await session.handleModelTurn({
      instructions: "Test task",
      input: [{ role: "user", content: "Hello" }],
      tools: []
    });

    const fnCall = firstTurn.output[0] as { name: string; arguments: string; call_id: string };
    expect(fnCall.name).toBe("final_response");
    expect(JSON.parse(fnCall.arguments)).toMatchObject({ message: "Done via ACP" });

    session.onRunEnded({ status: "completed" });
    bridgeHost.registry.unregister("run-1");
    await driverDone;

    expect(onUsage).toHaveBeenCalledWith({
      inputTokens: 246,
      cachedInputTokens: 60,
      cacheWriteInputTokens: 0,
      outputTokens: 28,
      reasoningTokens: 10
    });
    expect(cleanupSync).toHaveBeenCalledWith(expect.objectContaining({
      tierName: "Pro",
      tierId: "pro-tier",
      lastError: null
    }));
  });

  it("fails the bridge session when the ACP turn stalls past the inactivity timeout", async () => {
    process.env.FAKE_ACP_STALL = "1";
    const bridgeHost = await ensureWorkerBridgeHost();
    const { profile, scriptPath } = await createTempProfile();
    const session = new BridgeSession({ connectTimeoutMs: 10_000, idleTimeoutMs: 10_000 });
    const handoff = bridgeHost.registry.register({ runId: "run-stall", taskId: "task-stall", mode: "sandbox", session });

    const driver = new AgyAcpDriver({
      command: process.execPath,
      extraArgs: [scriptPath],
      profile,
      bridgeHost,
      bridgeSession: session,
      sessionCode: handoff.sessionCode,
      inactivityTimeoutMs: 150,
      hardTurnTimeoutMs: 1_000
    });

    const driverDone = driver.start();
    await expect(session.handleModelTurn({ instructions: "Stall test", input: [], tools: [] }))
      .rejects.toThrow(/stalled/i);

    await driver.stop();
    await driverDone;
    bridgeHost.registry.unregister("run-stall");
  });
});

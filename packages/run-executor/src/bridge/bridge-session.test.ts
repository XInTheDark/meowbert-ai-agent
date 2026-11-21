import { describe, expect, it, vi } from "vitest";
import { BridgeSession, BridgeSessionError } from "./bridge-session.js";
import { createBridgeModelGateway } from "./bridge-model-gateway.js";
import { runBridgeWebSearch } from "./bridge-web-search.js";
import type { ModelGateway } from "../agent/ports/model-gateway.js";

const SAMPLE_PNG_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+pW5QAAAAASUVORK5CYII=";

describe("BridgeSession and BridgeModelGateway", () => {
  it("inverts turns, forwards shownItems images and mid-run steering, and resolves final_response on run end", async () => {
    const statuses: string[] = [];
    const session = new BridgeSession({
      coalesceWindowMs: 0,
      onStatusChange: (status) => statuses.push(status)
    });
    const gateway = createBridgeModelGateway({ session });

    const req1Body = {
      instructions: "Follow workspace rules.",
      input: [{ role: "user", content: [{ type: "input_text", text: "Inspect chart.png" }] }],
      tools: [
        { type: "function", name: "view_image", description: "View image", parameters: { type: "object", properties: { file_path: { type: "string" } }, required: ["file_path"] } },
        { type: "custom", name: "apply_patch", description: "Patch file" },
        { type: "function", name: "final_response", description: "Finish", parameters: { type: "object", properties: { response: { type: "string" } }, required: ["response"] } }
      ]
    };

    // Start turn 1 before harness connects
    const turn1Promise = gateway.create({ purpose: "turn", body: req1Body, timeoutMs: 60_000 });

    // Harness claims session
    const startResult = await session.claimStart();
    expect(startResult.isError).toBeUndefined();
    expect(startResult.content[0]).toMatchObject({ type: "text" });
    expect((startResult.content[0] as { type: "text"; text: string }).text).toContain("Inspect chart.png");
    expect(statuses).toEqual(["connected"]);

    // Tool normalization turns custom apply_patch into a function tool
    const tools = session.listAvailableTools();
    expect(tools.map((t) => t.name)).toEqual(["view_image", "apply_patch", "final_response"]);

    // Harness calls view_image
    const imageCallPromise = session.invokeTool("view_image", { file_path: "chart.png" });
    const turn1 = await turn1Promise;
    expect(turn1.weightedTokens).toBeNull();
    expect(turn1.response.output).toHaveLength(1);
    const fc1 = turn1.response.output[0] as { type: string; call_id: string; name: string; arguments: string };
    expect(fc1.type).toBe("function_call");
    expect(fc1.name).toBe("view_image");

    // Loop executes view_image and calls gateway.create(req #2) with output + shownItems image + steering
    const req2Body = {
      ...req1Body,
      input: [
        ...req1Body.input,
        fc1,
        { type: "function_call_output", call_id: fc1.call_id, output: JSON.stringify({ ok: true, file_path: "/task/chart.png" }) },
        { role: "user", content: [{ type: "input_image", image_url: `data:image/png;base64,${SAMPLE_PNG_BASE64}` }] },
        { role: "user", content: [{ type: "input_text", text: "Also mention the peak value." }] }
      ]
    };
    const turn2Promise = gateway.create({ purpose: "turn", body: req2Body, timeoutMs: 60_000 });

    const imageResult = await imageCallPromise;
    expect(imageResult.content.some((block) => block.type === "image" && block.mimeType === "image/png" && block.data === SAMPLE_PNG_BASE64)).toBe(true);
    expect(imageResult.content.some((block) => block.type === "text" && block.text.includes("Also mention the peak value."))).toBe(true);

    // Harness calls final_response — loop will exit without req #3
    const finalCallPromise = session.invokeTool("final_response", { response: "Peak is 42.", notify: true });
    const turn2 = await turn2Promise;
    const fc2 = turn2.response.output[0] as { name: string };
    expect(fc2.name).toBe("final_response");

    // Run finalizes and resolves the waiting final_response MCP call cleanly
    session.onRunEnded({ status: "completed" });
    const finalResult = await finalCallPromise;
    expect(finalResult.isError).toBe(false);
    expect((finalResult.content[0] as { type: "text"; text: string }).text).toContain("finalized");
    expect(statuses).toEqual(["connected", "completed"]);
  });

  it("handles claimStart arriving slightly before turn 1 and coalesces parallel tool calls", async () => {
    const session = new BridgeSession({ coalesceWindowMs: 20 });
    const startPromise = session.claimStart();

    const turn1Promise = session.handleModelTurn({
      input: [{ role: "user", content: "Hello" }],
      tools: []
    });

    const started = await startPromise;
    expect(started.isError).toBeUndefined();

    const callA = session.invokeTool("run_shell", { command: "echo A" });
    const callB = session.invokeTool("run_shell", { command: "echo B" });
    const resp = await turn1Promise;
    expect(resp.output).toHaveLength(2);
    const [fcA, fcB] = resp.output as Array<{ call_id: string; name: string }>;

    const turn2Promise = session.handleModelTurn({
      input: [
        { role: "user", content: "Hello" },
        fcA,
        { type: "function_call_output", call_id: fcA.call_id, output: "A" },
        fcB,
        { type: "function_call_output", call_id: fcB.call_id, output: "B" }
      ],
      tools: []
    });

    const [resA, resB] = await Promise.all([callA, callB]);
    expect((resA.content[0] as { type: "text"; text: string }).text).toBe("A");
    expect((resB.content[0] as { type: "text"; text: string }).text).toBe("B");

    session.cancel();
    await expect(turn2Promise).rejects.toThrow("TASK_CANCELLED");
  });

  it("parks cleanly on idle timeout and rejects tools called before start or after cancel", async () => {
    const session = new BridgeSession({ connectTimeoutMs: 40, idleTimeoutMs: 40, coalesceWindowMs: 0 });
    const earlyCall = await session.invokeTool("run_shell", { command: "ls" });
    expect(earlyCall.isError).toBe(true);
    expect((earlyCall.content[0] as { type: "text"; text: string }).text).toContain("meowbert_start");

    const turnPromise = session.handleModelTurn({ input: [], tools: [] });
    await expect(turnPromise).rejects.toBeInstanceOf(BridgeSessionError);
    expect(session.getStatus()).toBe("parked");

    const postParkCall = await session.invokeTool("run_shell", { command: "ls" });
    expect(postParkCall.isError).toBe(true);
  });

  it("delegates auxiliary calls to fallback gateway and disables compaction and quota checks", async () => {
    const session = new BridgeSession({ coalesceWindowMs: 0 });
    const fallback: ModelGateway = {
      create: vi.fn(async () => ({ response: { id: "title_1", output: [], output_text: "" } as never, weightedTokens: 5 })),
      isQuotaExceeded: vi.fn(async () => true)
    };
    const gateway = createBridgeModelGateway({ session, fallback });

    expect(await gateway.isQuotaExceeded()).toBe(false);
    const titleRes = await gateway.create({ purpose: "title", body: {}, timeoutMs: 5_000 });
    expect(titleRes.weightedTokens).toBe(5);
    expect(fallback.create).toHaveBeenCalledOnce();

    await expect(gateway.create({ purpose: "compaction", body: {}, timeoutMs: 5_000 })).rejects.toThrow(/compaction/i);
  });

  it("runs bridge web search via hosted web_search tool for non-Claude models and cherry header for Claude", async () => {
    const create = vi.fn(async () => ({
      response: { id: "ws_1", output: [], output_text: "Result with https://example.com" } as never,
      weightedTokens: 3
    }));
    const models: ModelGateway = { create, isQuotaExceeded: async () => false };

    const openaiAnswer = await runBridgeWebSearch({
      models,
      chatGptCodex: false,
      modelType: "openai",
      query: "latest node lts"
    });
    expect(openaiAnswer).toContain("https://example.com");
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      purpose: "web_search",
      body: expect.objectContaining({
        tools: [expect.objectContaining({ type: "web_search" })]
      })
    }));

    create.mockClear();
    const claudeAnswer = await runBridgeWebSearch({
      models,
      chatGptCodex: false,
      modelType: "claude",
      query: "latest node lts"
    });
    expect(claudeAnswer).toContain("https://example.com");
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      purpose: "web_search",
      headers: expect.objectContaining({ "x-meridian-agent": "cherry" }),
      body: expect.objectContaining({ tools: [] })
    }));
  });
});

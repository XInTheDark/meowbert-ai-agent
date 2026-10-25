import { EventEmitter } from "node:events";
import { beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ launch: vi.fn(), factory: null as null | (() => Promise<unknown>) }));
vi.mock("playwright", () => ({ chromium: { launchPersistentContext: state.launch } }));
vi.mock("@playwright/mcp", () => ({ createConnection: async (_config: unknown, factory: () => Promise<unknown>) => {
  state.factory = factory; return { connect: async () => {} };
} }));
vi.mock("@modelcontextprotocol/sdk/client/index.js", () => ({ Client: class {
  async connect() {}
  async close() {}
  async callTool() { await state.factory!(); return { content: [] }; }
} }));
import { createHostBrowserService } from "./service";
function context() { const emitter = new EventEmitter(); return Object.assign(emitter, { close: vi.fn(async () => { emitter.emit("close"); }) }); }
beforeEach(() => { vi.clearAllMocks(); });

it("keeps one task owner and reuses the persistent profile after release", async () => {
  const browser = context(); state.launch.mockResolvedValue(browser);
  const service = createHostBrowserService("/desktop-data");
  const first = await service.connect("first", new AbortController().signal);
  await first.client.callTool({ name: "browser_navigate", arguments: { url: "https://example.test" } });
  const second = await service.connect("second", new AbortController().signal);
  await expect(second.client.callTool({ name: "browser_snapshot" })).rejects.toThrow("in use by first");
  await service.release("first");
  expect(browser.close).toHaveBeenCalledOnce();
  await second.client.callTool({ name: "browser_snapshot" });
  expect(state.launch).toHaveBeenNthCalledWith(1, "/desktop-data/browser-profile", { channel: "chrome", headless: false });
  expect(state.launch).toHaveBeenNthCalledWith(2, "/desktop-data/browser-profile", { channel: "chrome", headless: false });
  await service.release("second");
});

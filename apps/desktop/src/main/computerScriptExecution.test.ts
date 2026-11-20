import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ execFile: vi.fn() }));
vi.mock("node:child_process", () => ({ execFile: mocks.execFile }));
vi.mock("electron", () => ({
  app: {}, shell: {},
  screen: {
    getPrimaryDisplay: () => ({ id: 1, size: { width: 1280, height: 800 }, bounds: { x: 0, y: 0 }, scaleFactor: 1 }),
    getCursorScreenPoint: () => ({ x: 0, y: 0 })
  },
  systemPreferences: { isTrustedAccessibilityClient: () => true, getMediaAccessStatus: () => "granted" },
  desktopCapturer: { getSources: async () => [{ display_id: "1", thumbnail: { toJPEG: () => Buffer.from("image") } }] }
}));
import { performComputerAction } from "./computer";

beforeEach(() => {
  vi.useFakeTimers();
  mocks.execFile.mockReset().mockImplementation((_file, _args, _options, callback) => {
    callback(null, "", "");
  });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

it.each(["darwin", "win32"])("preserves replacement-pattern characters in %s typed text", async (platform) => {
  vi.stubGlobal("process", { ...process, platform });
  const text = "$' $& $` $$ price $50 and 'quotes'";
  const action = performComputerAction({ toolName: "computer_type", args: { text } });
  await vi.runAllTimersAsync();
  expect((await action).ok).toBe(true);
  const args = mocks.execFile.mock.calls[0][1] as string[];
  const script = args[args.length - 1];
  if (platform === "darwin") {
    const encoded = /const ACTION_JSON = (.+);/.exec(script)![1];
    expect(JSON.parse(JSON.parse(encoded))).toEqual({ type: "type", text });
  } else {
    const encoded = /^\$ActionJson = '(.+)'$/m.exec(script)![1].replaceAll("''", "'");
    expect(JSON.parse(encoded)).toEqual({ type: "type", text });
  }
});

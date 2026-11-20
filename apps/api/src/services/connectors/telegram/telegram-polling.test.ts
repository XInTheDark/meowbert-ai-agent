import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../lib/config.js", () => ({ config: { connectors: { telegram: { enabled: true } } } }));
vi.mock("../../../lib/db.js", () => ({ query: vi.fn(), pool: { connect: vi.fn() } }));
vi.mock("./index.js", () => ({ getTelegramBindingById: vi.fn(), processTelegramUpdateForBinding: vi.fn() }));
vi.mock("./telegram-shared.js", () => ({ processSharedTelegramUpdate: vi.fn() }));
vi.mock("../shared-connectors.js", () => ({ getSharedConnectorSetting: vi.fn(), setSharedTelegramLastUpdateId: vi.fn() }));

import { query, pool } from "../../../lib/db.js";
import { getTelegramBindingById, processTelegramUpdateForBinding } from "./index.js";
import { processSharedTelegramUpdate } from "./telegram-shared.js";
import { getSharedConnectorSetting, setSharedTelegramLastUpdateId } from "../shared-connectors.js";
import { startTelegramPollingLoop } from "./telegram-polling.js";

describe("Telegram polling partial progress", () => {
  let stop: (() => void) | undefined;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.resetAllMocks();
    vi.mocked(pool.connect).mockResolvedValue({
      on: vi.fn(), off: vi.fn(), release: vi.fn(), query: vi.fn(async () => ({ rows: [{ locked: true }] }))
    } as never);
  });
  afterEach(() => { stop?.(); stop = undefined; vi.useRealTimers(); vi.unstubAllGlobals(); });

  it.each(["custom", "shared"])("checkpoints successful %s updates before a later failure", async (mode) => {
    let cursor = 100;
    const binding = { id: "binding-1", status: "active", config_json: { mode: "polling", botToken: "token", lastUpdateId: cursor } };
    vi.mocked(query).mockImplementation(async (sql, values) => {
      if (sql.includes("SELECT id, config_json")) return { rows: mode === "custom" ? [binding] : [], rowCount: mode === "custom" ? 1 : 0 } as never;
      if (sql.includes("jsonb_set")) cursor = values?.[1] as number;
      return { rows: [], rowCount: 1 } as never;
    });
    vi.mocked(getTelegramBindingById).mockImplementation(async () => ({ ...binding, config_json: { ...binding.config_json, lastUpdateId: cursor } }) as never);
    vi.mocked(getSharedConnectorSetting).mockImplementation(async () => ({
      enabled: mode === "shared", hasToken: true, botToken: "token", telegramIngestMode: "polling", telegramLastUpdateId: cursor
    }) as never);
    vi.mocked(setSharedTelegramLastUpdateId).mockImplementation(async (value) => { cursor = value; });
    const handled: number[] = [];
    let failSecond = true;
    const process = async (id: number) => {
      if (id === 102 && failSecond) { failSecond = false; throw new Error("Temporary failure"); }
      handled.push(id);
    };
    vi.mocked(processTelegramUpdateForBinding).mockImplementation(async (_binding, update) => {
      await process(update.update_id!);
      return { processed: true } as never;
    });
    vi.mocked(processSharedTelegramUpdate).mockImplementation(async ({ update }) => {
      await process(update.update_id!);
      return { processed: true } as never;
    });
    const offsets: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      const offset = new URL(url).searchParams.get("offset")!;
      offsets.push(offset);
      return new Response(JSON.stringify({ ok: true, result: [101, 102].filter((id) => id >= Number(offset)).map((update_id) => ({ update_id })) }));
    }));
    stop = startTelegramPollingLoop({ info: vi.fn(), warn: vi.fn(), error: vi.fn() });
    await vi.advanceTimersByTimeAsync(3000);
    expect(cursor).toBe(101);
    expect(handled).toEqual([101]);
    await vi.advanceTimersByTimeAsync(3000);
    expect(cursor).toBe(102);
    expect(handled).toEqual([101, 102]);
    expect(offsets).toEqual(["101", "102"]);
  });
});

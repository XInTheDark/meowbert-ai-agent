import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { UsageActivationInput } from "@meowbert/shared";
vi.mock("../../lib/db.js", async () => {
  const { Pool } = await import("pg");
  const pool = new Pool({ connectionString: process.env.USAGE_ACTIVATION_TEST_DATABASE_URL, options: "-c search_path=activation_api_test" });
  return { pool, query: (sql: string, params?: unknown[]) => pool.query(sql, params),
    withTransaction: async (fn: (client: import("pg").PoolClient) => Promise<unknown>) => {
      const client = await pool.connect();
      try { await client.query("BEGIN"); const result = await fn(client); await client.query("COMMIT"); return result; }
      catch (error) { await client.query("ROLLBACK"); throw error; }
      finally { client.release(); }
    } };
});
import { pool, query } from "../../lib/db.js";
import { listUsageActivationSchedules, saveUsageActivationSchedule, removeUsageActivationSchedule } from "./admin-usage-activation.js";
import { removeAdminAiProvider } from "./admin-ai-providers.js";
const providerId = "11111111-1111-4111-8111-111111111111";
const input: UsageActivationInput = { name: "Morning", providerId, model: "model-a", enabled: false,
  rules: [{ kind: "at", days: [1, 2, 3, 4, 5], time: "03:00" }] };

describe.skipIf(!process.env.USAGE_ACTIVATION_TEST_DATABASE_URL)("activation admin persistence (PostgreSQL)", () => {
  beforeAll(async () => {
    await query("CREATE SCHEMA activation_api_test");
    await query(await readFile(new URL("../../../../../db/migrations/120_ai_providers.sql", import.meta.url), "utf8"));
    await query(await readFile(new URL("../../../../../db/migrations/127_scheduled_usage_activation.sql", import.meta.url), "utf8"));
  });
  afterAll(async () => { await query("DROP SCHEMA activation_api_test CASCADE"); await pool.end(); });
  beforeEach(async () => {
    await query("TRUNCATE usage_activation_schedules, ai_providers");
    await query("INSERT INTO ai_providers (id, base_url, api_key, is_selected) VALUES ($1, 'https://provider.test/v1', 'test-secret', true)", [providerId]);
  });
  it("persists create/edit/pause/delete without returning credentials or changing the platform provider", async () => {
    const created = await saveUsageActivationSchedule(input);
    expect(created.nextRunAt).toBeNull();
    const enabled = await saveUsageActivationSchedule({ ...input, enabled: true }, created.id);
    expect(new Date(enabled.nextRunAt!).getTime()).toBeGreaterThan(Date.now());
    expect(await listUsageActivationSchedules()).toEqual([enabled]);
    expect(JSON.stringify(enabled)).not.toContain("test-secret");
    expect((await query("SELECT is_selected FROM ai_providers")).rows[0].is_selected).toBe(true);
    expect((await saveUsageActivationSchedule(input, created.id)).nextRunAt).toBeNull();
    await removeUsageActivationSchedule(created.id);
    expect(await listUsageActivationSchedules()).toEqual([]);
  });
  it("rejects unknown providers and nonexistent schedule edits", async () => {
    await expect(saveUsageActivationSchedule({ ...input, providerId: "22222222-2222-4222-8222-222222222222" })).rejects.toMatchObject({ statusCode: 400 });
    await expect(saveUsageActivationSchedule(input, providerId)).rejects.toMatchObject({ statusCode: 404 });
  });
  it("pauses schedules when their provider is removed", async () => {
    await saveUsageActivationSchedule({ ...input, enabled: true });
    await removeAdminAiProvider(providerId);
    const [schedule] = await listUsageActivationSchedules();
    expect(schedule).toMatchObject({ providerId: null, enabled: false, nextRunAt: null });
  });
});

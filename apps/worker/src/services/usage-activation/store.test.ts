import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../lib/db.js", async () => {
  const { Pool } = await import("pg");
  const pool = new Pool({ connectionString: process.env.USAGE_ACTIVATION_TEST_DATABASE_URL,
    options: "-c search_path=activation_worker_test" });
  return { pool, query: (sql: string, params?: unknown[]) => pool.query(sql, params),
    withTransaction: async (fn: (client: import("pg").PoolClient) => Promise<unknown>) => {
      const client = await pool.connect();
      try { await client.query("BEGIN"); const result = await fn(client); await client.query("COMMIT"); return result; }
      catch (error) { await client.query("ROLLBACK"); throw error; }
      finally { client.release(); }
    } };
});
import { pool, query } from "../../lib/db.js";
import { claimDueActivations, expireActivationClaims, finishActivation, getActivationProvider } from "./store.js";

const providerId = "11111111-1111-4111-8111-111111111111";
const rules = [{ kind: "interval", days: [0, 1, 2, 3, 4, 5, 6], everyMinutes: 1, windows: [{ start: "00:00", end: "24:00" }] }];
async function seed(ageSeconds = 2, enabled = true): Promise<string> {
  const result = await query(`INSERT INTO usage_activation_schedules (name, provider_id, model, enabled, rules_json, next_run_at)
    VALUES ('Morning', $1, 'model-a', $2, $3, clock_timestamp() - $4 * interval '1 second') RETURNING id`,
  [providerId, enabled, JSON.stringify(rules), ageSeconds]);
  return result.rows[0].id;
}

describe.skipIf(!process.env.USAGE_ACTIVATION_TEST_DATABASE_URL)("activation claims (PostgreSQL)", () => {
  beforeAll(async () => {
    await query("CREATE SCHEMA activation_worker_test");
    await query(await readFile(new URL("../../../../../db/migrations/120_ai_providers.sql", import.meta.url), "utf8"));
    await query(await readFile(new URL("../../../../../db/migrations/127_scheduled_usage_activation.sql", import.meta.url), "utf8"));
  });
  afterAll(async () => { await query("DROP SCHEMA activation_worker_test CASCADE"); await pool.end(); });
  beforeEach(async () => {
    await query("TRUNCATE usage_activation_schedules, ai_providers");
    await query("INSERT INTO ai_providers (id, base_url, api_key) VALUES ($1, 'https://provider.test/v1', 'test-secret')", [providerId]);
  });
  it("claims each occurrence once across competing workers and excludes disabled schedules", async () => {
    const id = await seed();
    await seed(2, false);
    const claims = (await Promise.all([claimDueActivations(), claimDueActivations()])).flat();
    expect(claims).toHaveLength(1);
    expect(claims[0].id).toBe(id);
    expect(await getActivationProvider(claims[0])).toEqual({ baseUrl: "https://provider.test/v1", apiKey: "test-secret" });
    await query("UPDATE usage_activation_schedules SET next_run_at = now() - interval '2 seconds' WHERE id = $1", [id]);
    expect(await claimDueActivations()).toEqual([]);
  });
  it("skips missed occurrences and schedules only a future time", async () => {
    const id = await seed(3600);
    expect(await claimDueActivations()).toEqual([]);
    const result = await query("SELECT last_status, claim_token, next_run_at > now() AS future FROM usage_activation_schedules WHERE id = $1", [id]);
    expect(result.rows[0]).toEqual({ last_status: "skipped", claim_token: null, future: true });
  });
  it("invalidates claims on edits, disable and removal", async () => {
    await seed();
    const [claim] = await claimDueActivations();
    await query("UPDATE usage_activation_schedules SET revision = revision + 1 WHERE id = $1", [claim.id]);
    expect(await getActivationProvider(claim)).toBeNull();
    await query("UPDATE usage_activation_schedules SET revision = $2, enabled = false WHERE id = $1", [claim.id, claim.revision]);
    expect(await getActivationProvider(claim)).toBeNull();
    await query("DELETE FROM usage_activation_schedules WHERE id = $1", [claim.id]);
    expect(await getActivationProvider(claim)).toBeNull();
  });
  it("fences stale results and expires abandoned claims without replaying them", async () => {
    await seed();
    const [claim] = await claimDueActivations();
    await finishActivation({ ...claim, token: providerId }, "succeeded", null);
    expect((await query("SELECT last_status FROM usage_activation_schedules")).rows[0].last_status).toBe("running");
    await query("UPDATE usage_activation_schedules SET claim_until = now() - interval '1 second'");
    await expireActivationClaims();
    await finishActivation(claim, "succeeded", null);
    expect((await query("SELECT last_status FROM usage_activation_schedules")).rows[0].last_status).toBe("interrupted");
    expect(await claimDueActivations()).toEqual([]);
  });
  it("records successful results and releases the claim", async () => {
    await seed();
    const [claim] = await claimDueActivations();
    await finishActivation(claim, "succeeded", null);
    expect((await query("SELECT last_status, claim_token, claim_until, last_finished_at IS NOT NULL AS finished FROM usage_activation_schedules")).rows[0])
      .toEqual({ last_status: "succeeded", claim_token: null, claim_until: null, finished: true });
  });
  it("disables invalid persisted rules instead of repeatedly attempting them", async () => {
    await seed();
    await query("UPDATE usage_activation_schedules SET rules_json = '[]'");
    expect(await claimDueActivations()).toEqual([]);
    expect((await query("SELECT enabled, next_run_at, last_status FROM usage_activation_schedules")).rows[0])
      .toEqual({ enabled: false, next_run_at: null, last_status: "failed" });
  });
});

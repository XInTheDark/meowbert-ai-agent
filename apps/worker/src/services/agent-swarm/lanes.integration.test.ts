import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { normalizeAgentSwarmSettings, type AgentSwarmSettings, type TaskExecutionJob } from "@meowbert/shared";

// Supply a disposable PostgreSQL database with every migration applied.
const databaseUrl = process.env.TEST_SWARM_DATABASE_URL;

vi.mock("../../lib/db.js", async () => {
  const { Pool } = await import("pg");
  const pool = new Pool({ connectionString: process.env.TEST_SWARM_DATABASE_URL ?? "postgres://127.0.0.1:1/none", max: 4 });
  return {
    pool,
    query: (text: string, params: unknown[] = []) => pool.query(text, params),
    withTransaction: async <T>(fn: (client: import("pg").PoolClient) => Promise<T>): Promise<T> => {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const result = await fn(client);
        await client.query("COMMIT");
        return result;
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    }
  };
});
vi.mock("../../lib/queue.js", () => ({ taskQueue: { add: vi.fn(), getJob: vi.fn() } }));
vi.mock("../runtime/events.js", () => ({ emitTaskEvent: vi.fn() }));

const { pool } = await import("../../lib/db.js");
const { createForkedLanes } = await import("./lane-creation.js");
const { finishLaneRun } = await import("./lane-completion.js");
const { parkSwarmRun } = await import("./park.js");
const { appendSwarmMergeMessage } = await import("./merge-message.js");
const { insertSwarmNote } = await import("./notes-store.js");
const { appendSwarmNotes } = await import("./notes-delivery.js");
const { recoverSwarmsOnce } = await import("./recovery.js");
const { loadSwarmRunContext } = await import("./config.js");
const { loadLane } = await import("./lane-store.js");
const { prepareLaneRun } = await import("./lane-setup.js");

type SwarmRunContext = NonNullable<Awaited<ReturnType<typeof loadSwarmRunContext>>>;

describe.skipIf(!databaseUrl)("Agent Swarm lanes in PostgreSQL", () => {
  const workspaceId = randomUUID();
  const environmentId = randomUUID();

  async function createSwarm(advanced: Partial<AgentSwarmSettings["advanced"]> = {}): Promise<SwarmRunContext> {
    const taskId = randomUUID();
    const settings = normalizeAgentSwarmSettings({ leaderAgentId: "leader", advanced });
    await pool.query(
      `INSERT INTO tasks (id, workspace_id, environment_id, title, status, task_root_path, workflow_type)
       VALUES ($1, $2, $3, 'Swarm', 'running', $4, 'agent_swarm')`,
      [taskId, workspaceId, environmentId, `tasks/${taskId}`]
    );
    await pool.query("INSERT INTO task_swarms (task_id, config_json) VALUES ($1, $2::jsonb)", [taskId, JSON.stringify(settings)]);
    return (await loadSwarmRunContext({ id: taskId, workflow_type: "agent_swarm", workflow_parent_task_id: null, workflow_internal_role: null }))!;
  }

  async function laneContext(laneTaskId: string): Promise<SwarmRunContext> {
    const task = (await pool.query("SELECT id, workflow_type, workflow_parent_task_id, workflow_internal_role FROM tasks WHERE id = $1", [laneTaskId])).rows[0];
    return (await loadSwarmRunContext(task))!;
  }

  async function startRun(taskId: string, mode: TaskExecutionJob["mode"]): Promise<TaskExecutionJob> {
    const runId = randomUUID();
    await pool.query(
      "INSERT INTO task_runs (id, task_id, attempt_no, run_kind) SELECT $1, $2, COALESCE(MAX(attempt_no), 0) + 1, $3 FROM task_runs WHERE task_id = $2",
      [runId, taskId, mode]
    );
    return { taskId, runId, workspaceId, environmentId, triggerSource: "web", mode };
  }

  async function split(swarm: SwarmRunContext, parentTaskId: string, titles: string[]) {
    return createForkedLanes({
      swarm,
      parentTaskId,
      kind: "split",
      seed: {
        envelope: { baseVersion: "test", baseFrames: [], deltas: [] },
        tools: { response: [], codeMode: [] },
        items: [{ role: "user", content: "Find the programs." }],
        capabilities: {
          runtime: { model: "test-model", payload: {}, provider: { kind: "platform", baseUrl: "http://provider" } },
          runToolOptions: { webSearch: false, memorySearch: false, scheduleTask: false, subtasks: false, computerUse: false, enabledSkills: [], enabledSources: [] },
          loadedToolGroups: [],
          spinePath: null
        }
      },
      lanes: titles.map((title, index) => ({ label: String.fromCharCode(65 + index), title, direction: null, weight: 1 })),
      envRoot: "/env",
      buildForkOutput: (lane) => ({ brief: lane.title, item: { type: "function_call_output", call_id: "call_split", output: lane.title } })
    });
  }

  // Ends the lane's open run as if it submitted.
  async function submit(laneTaskId: string, status: "done" | "failed" = "done", summary = "Found it.") {
    const lane = (await loadLane(pool, laneTaskId))!;
    const run = (await pool.query<{ id: string }>("SELECT id FROM task_runs WHERE task_id = $1 AND ended_at IS NULL", [laneTaskId])).rows[0];
    return finishLaneRun({
      lane,
      runId: run.id,
      status,
      result: { summary, decisions: null, findings: null, files: [] },
      steps: 3,
      maxRunningLanes: 32
    });
  }

  function executionFor(job: TaskExecutionJob) {
    return {
      job,
      state: {
        currentLeafMessageId: null,
        contextManagement: { version: "v1" as const },
        dispatchState: { conversationItems: [] as Array<{ role: string; content: string }>, runPersistedItems: [] }
      }
    } as never as Parameters<typeof appendSwarmMergeMessage>[0] & { state: { dispatchState: { conversationItems: Array<{ role: string; content: string }> } } };
  }

  async function laneStatuses(parentTaskId: string): Promise<string[]> {
    const rows = await pool.query<{ status: string }>(
      "SELECT status FROM task_swarm_lanes WHERE parent_task_id = $1 ORDER BY created_at, task_id", [parentTaskId]);
    return rows.rows.map((row) => row.status);
  }

  async function pendingRuns(taskId: string): Promise<number> {
    const rows = await pool.query("SELECT id FROM task_runs WHERE task_id = $1 AND ended_at IS NULL", [taskId]);
    return rows.rowCount ?? 0;
  }

  beforeAll(async () => {
    await pool.query("INSERT INTO workspaces (id, name, slug) VALUES ($1, 'Swarm tests', $2)", [workspaceId, `swarm-${workspaceId}`]);
    await pool.query("INSERT INTO environments (id, workspace_id, name, root_path) VALUES ($1, $2, 'Swarm', '/env')", [environmentId, workspaceId]);
  });

  afterAll(async () => {
    await pool.query("DELETE FROM task_swarms WHERE task_id IN (SELECT id FROM tasks WHERE workspace_id = $1)", [workspaceId]);
    await pool.query("DELETE FROM tasks WHERE workspace_id = $1", [workspaceId]);
    await pool.query("DELETE FROM environments WHERE id = $1", [environmentId]);
    await pool.query("DELETE FROM workspaces WHERE id = $1", [workspaceId]);
    await pool.end();
  });

  it("parks the parent, starts lanes within the running cap, and wakes the parent once when the last lane ends", async () => {
    const swarm = await createSwarm({ maxRunningLanes: 2 });
    const leaderJob = await startRun(swarm.swarmTaskId, "agent_swarm_leader");
    const lanes = await split(swarm, swarm.swarmTaskId, ["EU", "PT2030", "Regional"]);
    expect(await laneStatuses(swarm.swarmTaskId)).toEqual(["running", "running", "queued"]);

    expect(await parkSwarmRun({ job: leaderJob, swarmTaskId: swarm.swarmTaskId, maxRunningLanes: 2, reason: "lanes" }))
      .toEqual({ wokeImmediately: false });
    const leaderRun = (await pool.query("SELECT exit_reason, ended_at FROM task_runs WHERE id = $1", [leaderJob.runId])).rows[0];
    expect(leaderRun.exit_reason).toBe("swarm_wait");
    expect(leaderRun.ended_at).not.toBeNull();

    await submit(lanes[0].taskId);
    expect(await laneStatuses(swarm.swarmTaskId)).toEqual(["done", "running", "running"]);
    await submit(lanes[1].taskId, "failed", "Provider kept failing.");
    expect(await pendingRuns(swarm.swarmTaskId)).toBe(0);

    const last = await submit(lanes[2].taskId);
    expect(last.parentWoken).toBe(true);
    expect(await pendingRuns(swarm.swarmTaskId)).toBe(1);
    expect((await pool.query("SELECT 1 FROM task_swarm_parks WHERE task_id = $1", [swarm.swarmTaskId])).rowCount).toBe(0);

    await recoverSwarmsOnce();
    expect(await pendingRuns(swarm.swarmTaskId)).toBe(1);
  });

  it("delivers each finished lane's result to its parent exactly once", async () => {
    const swarm = await createSwarm();
    const leaderJob = await startRun(swarm.swarmTaskId, "agent_swarm_leader");
    const lanes = await split(swarm, swarm.swarmTaskId, ["EU", "PT2030"]);
    await parkSwarmRun({ job: leaderJob, swarmTaskId: swarm.swarmTaskId, maxRunningLanes: 32, reason: "lanes" });
    await submit(lanes[0].taskId, "done", "Nine EU programs.");
    await submit(lanes[1].taskId, "done", "Four national programs.");

    const resumed = (await pool.query("SELECT id FROM task_runs WHERE task_id = $1 AND ended_at IS NULL", [swarm.swarmTaskId])).rows[0];
    const execution = executionFor({ ...leaderJob, runId: resumed.id });
    await appendSwarmMergeMessage(execution, swarm);
    await appendSwarmMergeMessage(execution, swarm);

    const items = execution.state.dispatchState.conversationItems;
    expect(items).toHaveLength(1);
    expect(items[0].content).toContain("Nine EU programs.");
    expect(items[0].content).toContain("Four national programs.");
  });

  it("wakes a parent straight away when its lanes finished before it parked", async () => {
    const swarm = await createSwarm();
    const leaderJob = await startRun(swarm.swarmTaskId, "agent_swarm_leader");
    const [lane] = await split(swarm, swarm.swarmTaskId, ["Only lane"]);
    await submit(lane.taskId);

    expect(await parkSwarmRun({ job: leaderJob, swarmTaskId: swarm.swarmTaskId, maxRunningLanes: 32, reason: "lanes" }))
      .toEqual({ wokeImmediately: true });
    expect(await pendingRuns(swarm.swarmTaskId)).toBe(1);
  });

  it("rejects a split that would exceed the fan-out cap", async () => {
    const swarm = await createSwarm({ maxLanesPerParent: 2 });
    await split(swarm, swarm.swarmTaskId, ["A", "B"]);
    await expect(split(swarm, swarm.swarmTaskId, ["C"])).rejects.toThrow(/at most 2 lanes/);
  });

  it("gives a lane notes from its siblings and ancestors, never its own or another branch's", async () => {
    const swarm = await createSwarm();
    await startRun(swarm.swarmTaskId, "agent_swarm_leader");
    const [eu, national] = await split(swarm, swarm.swarmTaskId, ["EU", "National"]);
    const euContext = await laneContext(eu.taskId);
    const [eic, life] = await split(euContext, eu.taskId, ["EIC", "LIFE"]);
    const nationalContext = await laneContext(national.taskId);
    const [regional] = await split(nationalContext, national.taskId, ["Regional"]);

    const note = (author: string, scope: string, content: string) => insertSwarmNote({
      swarmTaskId: swarm.swarmTaskId, authorTaskId: author, scopeParentTaskId: scope, kind: "shared", content
    });
    await note(eu.taskId, swarm.swarmTaskId, "SME status fails above 25% corporate ownership.");
    await note(life.taskId, eu.taskId, "LIFE closes in March.");
    await note(eic.taskId, eu.taskId, "EIC's own note.");
    await note(regional.taskId, national.taskId, "Lisbon fund is paused.");

    const eicContext = await laneContext(eic.taskId);
    const eicJob = await startRun(eic.taskId, "agent_swarm_lane");
    const execution = executionFor(eicJob);
    await appendSwarmNotes(execution, eicContext);
    await appendSwarmNotes(execution, eicContext);

    const items = execution.state.dispatchState.conversationItems;
    expect(items).toHaveLength(1);
    expect(items[0].content).toContain("SME status fails");
    expect(items[0].content).toContain("LIFE closes in March.");
    expect(items[0].content).not.toContain("EIC's own note.");
    expect(items[0].content).not.toContain("Lisbon fund");
  });

  it("starts a lane from the seed and its own fork result, and replays that history unchanged", async () => {
    const swarm = await createSwarm();
    await startRun(swarm.swarmTaskId, "agent_swarm_leader");
    const [lane] = await split(swarm, swarm.swarmTaskId, ["EU"]);
    const messages = (await pool.query("SELECT id, role, content_json, parent_message_id, edited_from_message_id, created_at FROM task_messages WHERE task_id = $1", [lane.taskId])).rows;
    const setup = (await loadLane(pool, lane.taskId))!;
    const input = { taskId: lane.taskId, lane: setup, messages, branchLeafMessageId: messages[0].id, runtimeModel: "test-model" };

    const first = await prepareLaneRun(input);
    const second = await prepareLaneRun(input);

    expect(first.conversationItems).toEqual([
      { role: "user", content: "Find the programs." },
      { type: "function_call_output", call_id: "call_split", output: "EU" }
    ]);
    expect(second.conversationItems).toEqual(first.conversationItems);
    expect(second.promptEnvelope.sealed).toBe(true);
  });

  it("recovers a parked parent whose barrier was met without waking it", async () => {
    const swarm = await createSwarm();
    const leaderJob = await startRun(swarm.swarmTaskId, "agent_swarm_leader");
    const [lane] = await split(swarm, swarm.swarmTaskId, ["Only lane"]);
    await parkSwarmRun({ job: leaderJob, swarmTaskId: swarm.swarmTaskId, maxRunningLanes: 32, reason: "lanes" });
    // The lane ends without the barrier check, as after a crash between the two.
    await pool.query("UPDATE task_swarm_lanes SET status = 'done', ended_at = now() WHERE task_id = $1", [lane.taskId]);
    await pool.query("UPDATE task_runs SET ended_at = now() WHERE task_id = $1", [lane.taskId]);
    expect(await pendingRuns(swarm.swarmTaskId)).toBe(0);

    await recoverSwarmsOnce();
    expect(await pendingRuns(swarm.swarmTaskId)).toBe(1);
  });
});

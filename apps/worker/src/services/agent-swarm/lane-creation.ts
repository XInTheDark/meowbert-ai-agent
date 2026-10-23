import { randomUUID } from "node:crypto";
import path from "node:path";
import type { PoolClient } from "pg";
import { createTaskMessageMetadata, type ChosenModelRoute } from "@meowbert/shared";
import type { ResponseInputItem } from "openai/resources/responses/responses";
import { withTransaction } from "../../lib/db.js";
import type { SwarmRunContext } from "./config.js";
import { allocateForkSharesInTx } from "./budget-shares.js";
import { insertForkSeedInTx, type ForkSeed } from "./fork-seed.js";
import { countActiveChildrenInTx, insertLaneInTx, type SwarmLaneKind } from "./lane-store.js";
import { lockSwarmInTx, startQueuedLanesInTx } from "./scheduler.js";
import { SwarmToolError } from "./tool-error.js";

export interface NewLane {
  label: string;
  title: string;
  direction: string | null;
  weight: number;
  modelRoute: ChosenModelRoute | null;
}

export interface CreatedLane {
  taskId: string;
  label: string;
  title: string;
}

interface SwarmRootRow {
  workspace_id: string;
  environment_id: string;
  initiator_user_id: string | null;
  task_root_path: string;
  default_timezone: string;
  max_steps_override: number | null;
}

// Takes the swarm lock and checks the parent may start `count` more lanes. Caller is in a transaction.
async function prepareLaneCreationInTx(client: PoolClient, swarm: SwarmRunContext, parentTaskId: string, count: number): Promise<SwarmRootRow> {
  await lockSwarmInTx(client, swarm.swarmTaskId);
  const parent = await client.query<{ cancellation_requested: boolean }>(
    "SELECT cancellation_requested FROM tasks WHERE id = $1 FOR UPDATE", [parentTaskId]
  );
  if (parent.rows[0]?.cancellation_requested) throw new Error("TASK_CANCELLED");
  const active = await countActiveChildrenInTx(client, parentTaskId);
  const maxLanes = swarm.settings.advanced.maxLanesPerParent;
  if (active + count > maxLanes) {
    throw new SwarmToolError(`A parent can run at most ${maxLanes} lanes at once; ${active} are still active.`);
  }
  return (await client.query<SwarmRootRow>(
    `SELECT workspace_id, environment_id, initiator_user_id, task_root_path, default_timezone, max_steps_override
       FROM tasks WHERE id = $1`,
    [swarm.swarmTaskId]
  )).rows[0];
}

export function laneRootPath(root: Pick<SwarmRootRow, "task_root_path">, laneTaskId: string): string {
  return `${root.task_root_path.replace(/\/+$/, "")}/lanes/${laneTaskId}`;
}

// Lanes are tasks of the swarm: hidden workflow children of the root, never subtasks of their parent.
// Their task root is <swarm root>/lanes/<lane id>.
async function insertLaneTaskInTx(client: PoolClient, input: {
  root: SwarmRootRow;
  swarm: SwarmRunContext;
  taskId: string;
  title: string;
  firstMessage: Record<string, unknown>;
}): Promise<void> {
  const { root } = input;
  await client.query(
    `INSERT INTO tasks (id, workspace_id, environment_id, title, status, source, initiator_user_id, task_root_path,
       default_timezone, max_steps_override, workflow_type, workflow_internal_role, workflow_parent_task_id)
     VALUES ($1, $2, $3, $4, 'queued', 'web', $5, $6, $7, $8, 'agent_swarm', 'lane', $9)`,
    [input.taskId, root.workspace_id, root.environment_id, input.title, root.initiator_user_id, laneRootPath(root, input.taskId),
      root.default_timezone, root.max_steps_override, input.swarm.swarmTaskId]
  );
  await client.query(
    `INSERT INTO task_messages (task_id, role, content_json, message_metadata_json, author_user_id)
     VALUES ($1, 'user', $2::jsonb, $3::jsonb, $4)`,
    [input.taskId, JSON.stringify(input.firstMessage), JSON.stringify(createTaskMessageMetadata(new Date().toISOString())),
      root.initiator_user_id]
  );
}

// Split and diverge lanes. Their first message carries the lane's own result for the fork call, so
// the lane's history is the seed followed by that result.
export async function createForkedLanes(input: {
  swarm: SwarmRunContext;
  parentTaskId: string;
  kind: Exclude<SwarmLaneKind, "check">;
  seed: Omit<ForkSeed, "id">;
  lanes: NewLane[];
  envRoot: string;
  buildForkOutput: (lane: NewLane & { laneDir: string }) => { brief: string; item: ResponseInputItem };
}): Promise<CreatedLane[]> {
  const { swarm } = input;
  return withTransaction(async (client) => {
    const root = await prepareLaneCreationInTx(client, swarm, input.parentTaskId, input.lanes.length);
    const shares = await allocateForkSharesInTx(client, swarm, input.parentTaskId, input.lanes.map((lane) => lane.weight));
    const seedId = await insertForkSeedInTx(client, { ...input.seed, swarmTaskId: swarm.swarmTaskId, sourceTaskId: input.parentTaskId });
    const depth = (swarm.lane?.depth ?? 0) + 1;
    const created: CreatedLane[] = [];
    for (const [index, lane] of input.lanes.entries()) {
      const taskId = randomUUID();
      const forkOutput = input.buildForkOutput({ ...lane, laneDir: path.resolve(input.envRoot, laneRootPath(root, taskId)) });
      await insertLaneTaskInTx(client, {
        root,
        swarm,
        taskId,
        title: lane.title,
        firstMessage: { text: forkOutput.brief, tools: input.seed.capabilities.runToolOptions, swarm_fork_output: forkOutput.item }
      });
      await insertLaneInTx(client, {
        taskId,
        swarmTaskId: swarm.swarmTaskId,
        parentTaskId: input.parentTaskId,
        depth,
        kind: input.kind,
        title: lane.title,
        direction: lane.direction,
        forkSeedId: seedId,
        weight: lane.weight,
        modelRoute: lane.modelRoute,
        shareTokens: shares[index]
      });
      created.push({ taskId, label: lane.label, title: lane.title });
    }
    await startQueuedLanesInTx(client, swarm.swarmTaskId, swarm.settings.advanced.maxRunningLanes);
    return created;
  });
}

// A Check lane is a fresh task, never a fork: its brief is an ordinary first message and it goes
// through normal run setup. Its seed carries no history, only the runtime it runs on.
export async function createCheckLane(input: {
  swarm: SwarmRunContext;
  parentTaskId: string;
  seed: Pick<ForkSeed, "capabilities">;
  focus: string | null;
  modelRoute: ChosenModelRoute | null;
  envRoot: string;
  buildBrief: (laneDir: string) => string;
}): Promise<CreatedLane> {
  const { swarm } = input;
  return withTransaction(async (client) => {
    const root = await prepareLaneCreationInTx(client, swarm, input.parentTaskId, 1);
    const seedId = await insertForkSeedInTx(client, {
      envelope: { baseVersion: "check", baseFrames: [], deltas: [] },
      tools: { response: [], codeMode: [] },
      items: [],
      capabilities: input.seed.capabilities,
      swarmTaskId: swarm.swarmTaskId,
      sourceTaskId: input.parentTaskId
    });
    const taskId = randomUUID();
    const title = "Check";
    await insertLaneTaskInTx(client, {
      root,
      swarm,
      taskId,
      title,
      firstMessage: {
        text: input.buildBrief(path.resolve(input.envRoot, laneRootPath(root, taskId))),
        tools: input.seed.capabilities.runToolOptions
      }
    });
    await insertLaneInTx(client, {
      taskId,
      swarmTaskId: swarm.swarmTaskId,
      parentTaskId: input.parentTaskId,
      depth: (swarm.lane?.depth ?? 0) + 1,
      kind: "check",
      title,
      direction: input.focus,
      forkSeedId: seedId,
      weight: 1,
      modelRoute: input.modelRoute,
      // Check is paid from the swarm's reserve rather than a share of its own.
      shareTokens: null
    });
    await startQueuedLanesInTx(client, swarm.swarmTaskId, swarm.settings.advanced.maxRunningLanes);
    return { taskId, label: "Check", title };
  });
}

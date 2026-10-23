import { randomUUID } from "node:crypto";
import path from "node:path";
import { createTaskMessageMetadata } from "@meowbert/shared";
import type { ResponseInputItem } from "openai/resources/responses/responses";
import { withTransaction } from "../../lib/db.js";
import type { SwarmRunContext } from "./config.js";
import { insertForkSeedInTx, type ForkSeed } from "./fork-seed.js";
import { countActiveChildrenInTx, insertLaneInTx, type SwarmLaneKind } from "./lane-store.js";
import { lockSwarmInTx, startQueuedLanesInTx } from "./scheduler.js";

export interface NewLane {
  label: string;
  title: string;
  direction: string | null;
  weight: number;
}

export interface CreatedLane {
  taskId: string;
  label: string;
  title: string;
}

// Lanes are tasks of the swarm: hidden workflow children of the root, never subtasks of their parent.
// Their task root is <swarm root>/lanes/<lane id>, and their first message carries the lane's own
// result for the fork call, so the lane's history is the seed followed by that result.
export async function createForkedLanes(input: {
  swarm: SwarmRunContext;
  parentTaskId: string;
  kind: SwarmLaneKind;
  seed: Omit<ForkSeed, "id">;
  lanes: NewLane[];
  envRoot: string;
  buildForkOutput: (lane: NewLane & { laneDir: string }) => { brief: string; item: ResponseInputItem };
}): Promise<CreatedLane[]> {
  const { swarm } = input;
  return withTransaction(async (client) => {
    await lockSwarmInTx(client, swarm.swarmTaskId);
    const parent = await client.query<{ cancellation_requested: boolean }>(
      "SELECT cancellation_requested FROM tasks WHERE id = $1 FOR UPDATE", [input.parentTaskId]
    );
    if (parent.rows[0]?.cancellation_requested) throw new Error("TASK_CANCELLED");
    const active = await countActiveChildrenInTx(client, input.parentTaskId);
    const maxLanes = swarm.settings.advanced.maxLanesPerParent;
    if (active + input.lanes.length > maxLanes) {
      throw new Error(`A parent can run at most ${maxLanes} lanes at once; ${active} are still active.`);
    }
    const root = (await client.query<{
      workspace_id: string; environment_id: string; initiator_user_id: string | null;
      task_root_path: string; default_timezone: string; max_steps_override: number | null;
    }>(
      `SELECT workspace_id, environment_id, initiator_user_id, task_root_path, default_timezone, max_steps_override
         FROM tasks WHERE id = $1`,
      [swarm.swarmTaskId]
    )).rows[0];
    const seedId = await insertForkSeedInTx(client, { ...input.seed, swarmTaskId: swarm.swarmTaskId, sourceTaskId: input.parentTaskId });
    const depth = (swarm.lane?.depth ?? 0) + 1;
    const created: CreatedLane[] = [];
    for (const lane of input.lanes) {
      const taskId = randomUUID();
      const rootPath = `${root.task_root_path.replace(/\/+$/, "")}/lanes/${taskId}`;
      const forkOutput = input.buildForkOutput({ ...lane, laneDir: path.resolve(input.envRoot, rootPath) });
      await client.query(
        `INSERT INTO tasks (id, workspace_id, environment_id, title, status, source, initiator_user_id, task_root_path,
           default_timezone, max_steps_override, workflow_type, workflow_internal_role, workflow_parent_task_id)
         VALUES ($1, $2, $3, $4, 'queued', 'web', $5, $6, $7, $8, 'agent_swarm', 'lane', $9)`,
        [taskId, root.workspace_id, root.environment_id, lane.title, root.initiator_user_id, rootPath,
          root.default_timezone, root.max_steps_override, swarm.swarmTaskId]
      );
      await client.query(
        `INSERT INTO task_messages (task_id, role, content_json, message_metadata_json, author_user_id)
         VALUES ($1, 'user', $2::jsonb, $3::jsonb, $4)`,
        [taskId, JSON.stringify({ text: forkOutput.brief, tools: input.seed.capabilities.runToolOptions, swarm_fork_output: forkOutput.item }),
          JSON.stringify(createTaskMessageMetadata(new Date().toISOString())), root.initiator_user_id]
      );
      await insertLaneInTx(client, {
        taskId,
        swarmTaskId: swarm.swarmTaskId,
        parentTaskId: input.parentTaskId,
        depth,
        kind: input.kind,
        title: lane.title,
        direction: lane.direction,
        forkSeedId: seedId,
        weight: lane.weight
      });
      created.push({ taskId, label: lane.label, title: lane.title });
    }
    await startQueuedLanesInTx(client, swarm.swarmTaskId, swarm.settings.advanced.maxRunningLanes);
    return created;
  });
}

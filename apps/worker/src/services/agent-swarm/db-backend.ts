import type { ResponseInputItem } from "openai/resources/responses/responses";
import type { SwarmBackend, SwarmRunRef } from "@meowbert/run-executor/agent-swarm/backend";
import { pool, withTransaction } from "../../lib/db.js";
import { inboxItemsMessage, insertRunInboxMessagesInTx, type RunInboxMessage } from "../agent/run-inbox.js";
import { chargeSwarmStep, loadBudgetState, markWrapUpNotified } from "./budget.js";
import { loadAutoCheckFiles, loadBranchUserMessages, loadLatestSpinePath } from "./check.js";
import { loadSwarmRunContext } from "./config.js";
import { emitTaskEvent } from "../runtime/events.js";
import { emitSwarmEvent } from "./events.js";
import { loadForkSeed } from "./fork-seed.js";
import { createCheckLane, createForkedLanes } from "./lane-creation.js";
import { finishLaneRun } from "./lane-completion.js";
import { resumeLane, steerLane, stopLane } from "./lane-control.js";
import { claimLaneInboxInTx } from "./lane-inbox.js";
import { countActiveChildrenInTx, hasOwnLanes } from "./lane-store.js";
import { claimMergeItemsInTx } from "./merge-message.js";
import { claimNoteItemsInTx } from "./notes-delivery.js";
import { insertSwarmNote } from "./notes-store.js";
import { recordLaneStep } from "./outcomes.js";
import { clearSwarmPark, parkSwarmRun } from "./park.js";
import { claimTurnNoteItemsInTx } from "./turn-notes.js";

function ownLane(run: SwarmRunRef) {
  const lane = run.swarm.lane;
  if (!lane) throw new Error("This run is not a swarm lane.");
  return lane;
}

// Swarm state for runs whose executor sits inside the control plane. The Run API serves the same
// backend to device runs, acting for the run whose lease made each call.
export const dbSwarmBackend: SwarmBackend = {
  async load(task, routers) {
    const swarm = await loadSwarmRunContext(task, routers);
    if (swarm) await clearSwarmPark(task.id);
    return swarm;
  },
  async loadForkSeed(run) {
    const seedId = run.swarm.lane?.fork_seed_id;
    return seedId ? loadForkSeed(seedId) : null;
  },
  // Each source is claimed and stored in one transaction, so a retried run never loses or repeats one.
  async claimInbox(run, request) {
    return withTransaction(async (client) => {
      await client.query("SELECT id FROM tasks WHERE id = $1 FOR UPDATE", [run.taskId]);
      const { swarm } = run;
      const lane = swarm.lane;
      const sources: ResponseInputItem[][] = [
        await claimMergeItemsInTx(client, run.taskId, swarm.settings),
        request.includeTurnNotes && !lane ? await claimTurnNoteItemsInTx(client, run.taskId, swarm) : [],
        await claimNoteItemsInTx(client, swarm)
      ];
      const laneInbox = lane ? await claimLaneInboxInTx(client, lane.task_id) : { items: [], stopped: false };
      sources.push(laneInbox.items);
      const messages: RunInboxMessage[] = sources.flatMap(inboxItemsMessage);
      const stored = await insertRunInboxMessagesInTx(client, {
        taskId: run.taskId,
        leafMessageId: request.leafMessageId,
        persistedItems: request.persistedItems,
        messages
      });
      if (!stored && !laneInbox.stopped) return null;
      return {
        leafMessageId: stored?.leaf ?? request.leafMessageId,
        items: stored ? sources.flat() : [],
        laneStopped: laneInbox.stopped
      };
    });
  },
  loadBudgetState: (run) => loadBudgetState(run.swarm, run.taskId),
  markWrapUpNotified: (run) => markWrapUpNotified(ownLane(run).task_id),
  hasActiveLanes: async (run) => await countActiveChildrenInTx(pool, run.taskId) > 0,
  async recordTurn(run, input) {
    await chargeSwarmStep(run.swarm, run.taskId, input.weightedTokens);
    const lane = run.swarm.lane;
    if (!lane) return;
    for (const content of input.autoNotes) {
      await insertSwarmNote({
        swarmTaskId: lane.swarm_task_id,
        authorTaskId: lane.task_id,
        scopeParentTaskId: lane.parent_task_id,
        kind: "auto",
        content
      });
    }
    await recordLaneStep(lane.task_id);
  },
  async forkLanes(run, input) {
    const prepared = new Map(input.lanes.map((lane) => [lane.taskId, lane]));
    return createForkedLanes({
      swarm: run.swarm,
      parentTaskId: run.taskId,
      kind: input.kind,
      seed: input.seed,
      crossModelSeed: input.crossModelSeed,
      isCrossModel: (lane) => prepared.get(lane.taskId!)?.crossModel === true,
      lanes: input.lanes.map(({ taskId, label, title, direction, weight, modelRoute }) => ({ taskId, label, title, direction, weight, modelRoute })),
      envRoot: "",
      buildForkOutput: (lane) => {
        const own = prepared.get(lane.taskId!)!;
        return { brief: own.brief, item: own.forkOutput };
      }
    });
  },
  hasOwnLanes: (run) => hasOwnLanes(pool, run.taskId),
  loadAutoCheckFiles: (run) => loadAutoCheckFiles(run.taskId),
  async loadCheckInputs(run, leafMessageId) {
    const [userMessages, spinePath] = await Promise.all([
      loadBranchUserMessages(run.swarm.swarmTaskId, leafMessageId),
      loadLatestSpinePath(run.taskId)
    ]);
    return { userMessages, spinePath };
  },
  startCheckLane: (run, input) => createCheckLane({
    swarm: run.swarm,
    parentTaskId: run.taskId,
    seed: { capabilities: input.capabilities },
    focus: input.focus,
    modelRoute: input.modelRoute,
    envRoot: "",
    buildBrief: () => input.brief,
    laneTaskId: input.laneTaskId
  }),
  steerLane: (run, input) => steerLane({ swarm: run.swarm, parentTaskId: run.taskId, ...input }),
  stopLane: (run, input) => stopLane({ swarm: run.swarm, parentTaskId: run.taskId, ...input }),
  async resumeLane(run, input) {
    const lane = await resumeLane({ swarm: run.swarm, parentTaskId: run.taskId, ...input });
    return { title: lane.title };
  },
  async shareNote(run, text) {
    const lane = ownLane(run);
    await insertSwarmNote({
      swarmTaskId: lane.swarm_task_id,
      authorTaskId: lane.task_id,
      scopeParentTaskId: lane.parent_task_id,
      kind: "shared",
      content: text
    });
  },
  emitEvent: (run, message) => emitSwarmEvent(run.swarm.swarmTaskId, message),
  async park(run, input) {
    await parkSwarmRun({
      job: input.job,
      swarmTaskId: run.swarm.swarmTaskId,
      maxRunningLanes: run.swarm.settings.advanced.maxRunningLanes,
      reason: input.reason
    });
    await emitTaskEvent(run.taskId, "status", { status: "queued", waitingForLanes: true });
  },
  async finishLane(run, input) {
    await finishLaneRun({
      lane: ownLane(run),
      runId: input.runId,
      status: input.status,
      result: input.result,
      maxRunningLanes: run.swarm.settings.advanced.maxRunningLanes
    });
  }
};

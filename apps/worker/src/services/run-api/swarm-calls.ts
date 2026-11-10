import type { ResponseInputItem } from "openai/resources/responses/responses";
import { reasoningScoreForEffort, type ChosenModelRoute, type RunApiMethod } from "@meowbert/shared";
import type { PreparedForkLane, SwarmRunRef } from "@meowbert/run-executor/agent-swarm/backend";
import type { ForkSeed, ForkSeedCapabilities } from "@meowbert/run-executor/agent-swarm/fork-types";
import type { SwarmLaneResult } from "@meowbert/run-executor/agent-swarm/lane-types";
import { checkSwarmToolRole } from "@meowbert/run-executor/agent-swarm/tools/role-gate";
import { SwarmToolError } from "@meowbert/run-executor/agent-swarm/tool-error";
import {
  CHECK_TOOL_NAME,
  DIVERGE_TOOL_NAME,
  RESUME_TOOL_NAME,
  SHARE_TOOL_NAME,
  SPLIT_TOOL_NAME,
  STEER_TOOL_NAME,
  STOP_LANE_TOOL_NAME,
  SUBMIT_TOOL_NAME
} from "@meowbert/run-executor/agent-tools/swarm";
import { query } from "../../lib/db.js";
import { dbSwarmBackend } from "../agent-swarm/db-backend.js";
import { clearSwarmPark } from "../agent-swarm/park.js";
import { RunApiFailure } from "./failure.js";
import type { RunApiSession, RunApiSwarm } from "./sessions.js";

type Handler = (session: RunApiSession, args: unknown[]) => Promise<unknown>;
type SwarmMethod = Extract<RunApiMethod, `swarm.${string}`>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_AUTO_NOTES = 3;
const MAX_AUTO_NOTE_CHARS = 1_000;

function invalid(message: string): never {
  throw new RunApiFailure("invalid_request", message);
}

function requireSwarm(session: RunApiSession): RunApiSwarm {
  if (!session.swarm) invalid("This run is not part of an Agent Swarm.");
  return session.swarm;
}

// Swarm calls act for the run that holds the lease, with the swarm the control plane loaded for it;
// nothing the executor sends names another task.
function runRef(session: RunApiSession): SwarmRunRef {
  return { taskId: session.taskId, swarm: requireSwarm(session).context };
}

function input<T extends object>(args: unknown[]): T {
  const value = args[0];
  if (!value || typeof value !== "object") invalid("A swarm call needs an input object.");
  return value as T;
}

function assertRole(session: RunApiSession, toolName: string): void {
  const error = checkSwarmToolRole(toolName, requireSwarm(session).context);
  if (error) throw new SwarmToolError(error);
}

async function assertOwnMessage(taskId: string, messageId: string | null): Promise<void> {
  if (messageId === null) return;
  if (typeof messageId !== "string" || !UUID.test(messageId)) invalid("Invalid message id.");
  const found = await query("SELECT 1 FROM task_messages WHERE id = $1 AND task_id = $2", [messageId, taskId]);
  if (!found.rowCount) invalid("That message is not on this run's task.");
}

// A lane model must come from the swarm's own router.
function checkedRoute(swarm: RunApiSwarm, route: ChosenModelRoute | null | undefined): ChosenModelRoute | null {
  if (!route) return null;
  const router = swarm.context.router;
  if (!router || route.routerId !== router.id || !router.models.some((target) => target.id === route.modelId)) {
    throw new SwarmToolError("That lane model is not offered by this swarm's router.");
  }
  return router.allowReasoningEffort && typeof route.reasoningScore === "number"
    ? route
    : { ...route, reasoningScore: reasoningScoreForEffort(null) };
}

// Lanes run on the model and provider their parent was admitted on, whatever the executor reports.
function withAdmittedRuntime<T extends { capabilities: ForkSeedCapabilities }>(swarm: RunApiSwarm, seed: T): T {
  return { ...seed, capabilities: { ...seed.capabilities, runtime: structuredClone(swarm.runtime) } };
}

function checkedForkLanes(swarm: RunApiSwarm, lanes: unknown): PreparedForkLane[] {
  if (!Array.isArray(lanes) || lanes.length === 0) invalid("A fork needs lanes.");
  const ids = new Set<string>();
  return lanes.map((value) => {
    const lane = value as PreparedForkLane;
    if (typeof lane.taskId !== "string" || !UUID.test(lane.taskId) || ids.has(lane.taskId)) invalid("Each lane needs its own id.");
    ids.add(lane.taskId);
    if (typeof lane.title !== "string" || typeof lane.brief !== "string" || typeof lane.label !== "string") invalid("Invalid lane.");
    if (typeof lane.weight !== "number" || !Number.isFinite(lane.weight) || lane.weight <= 0) invalid("Invalid lane weight.");
    return { ...lane, direction: typeof lane.direction === "string" ? lane.direction : null,
      modelRoute: checkedRoute(swarm, lane.modelRoute), crossModel: lane.crossModel === true };
  });
}

// Refusals reach the executor as a result, so it can show them to the model as the tool's output.
function refusable(handler: Handler): Handler {
  return async (session, args) => {
    try {
      return { ok: await handler(session, args) ?? null };
    } catch (error) {
      if (error instanceof SwarmToolError) return { refused: error.message };
      throw error;
    }
  };
}

export const SWARM_CALL_HANDLERS: Record<SwarmMethod, Handler> = {
  // A run that starts while its task is parked takes over from the park.
  "swarm.load": refusable(async (session) => {
    const swarm = requireSwarm(session);
    await clearSwarmPark(session.taskId);
    return structuredClone(swarm.context);
  }),
  "swarm.loadForkSeed": refusable((session) => dbSwarmBackend.loadForkSeed(runRef(session))),
  "swarm.claimInbox": refusable(async (session, args) => {
    const request = input<{ includeTurnNotes?: unknown; leafMessageId?: string | null; persistedItems?: unknown }>(args);
    const leafMessageId = request.leafMessageId ?? null;
    await assertOwnMessage(session.taskId, leafMessageId);
    const append = await dbSwarmBackend.claimInbox(runRef(session), {
      includeTurnNotes: request.includeTurnNotes === true,
      leafMessageId,
      persistedItems: Array.isArray(request.persistedItems) ? request.persistedItems as ResponseInputItem[] : []
    });
    if (append?.leafMessageId) session.leafMessageId = append.leafMessageId;
    return append;
  }),
  "swarm.loadBudgetState": refusable((session) => dbSwarmBackend.loadBudgetState(runRef(session))),
  "swarm.markWrapUpNotified": refusable((session) => dbSwarmBackend.markWrapUpNotified(runRef(session))),
  "swarm.hasActiveLanes": refusable((session) => dbSwarmBackend.hasActiveLanes(runRef(session))),
  // A device's model turns are charged to the swarm by the model proxy, which measured them.
  "swarm.recordTurn": refusable(async (session, args) => {
    const { autoNotes } = input<{ autoNotes?: unknown }>(args);
    const notes = Array.isArray(autoNotes)
      ? autoNotes.filter((note): note is string => typeof note === "string").slice(0, MAX_AUTO_NOTES).map((note) => note.slice(0, MAX_AUTO_NOTE_CHARS))
      : [];
    await dbSwarmBackend.recordTurn(runRef(session), { weightedTokens: null, autoNotes: notes });
  }),
  "swarm.forkLanes": refusable(async (session, args) => {
    const swarm = requireSwarm(session);
    const request = input<{ kind?: unknown; seed?: Omit<ForkSeed, "id">; crossModelSeed?: Omit<ForkSeed, "id"> | null; lanes?: unknown }>(args);
    if (request.kind !== "split" && request.kind !== "diverge") invalid("A fork is a split or a diverge.");
    assertRole(session, request.kind === "split" ? SPLIT_TOOL_NAME : DIVERGE_TOOL_NAME);
    if (!request.seed?.capabilities) invalid("A fork needs its seed.");
    return dbSwarmBackend.forkLanes(runRef(session), {
      kind: request.kind,
      seed: withAdmittedRuntime(swarm, request.seed),
      crossModelSeed: request.crossModelSeed?.capabilities ? withAdmittedRuntime(swarm, request.crossModelSeed) : null,
      lanes: checkedForkLanes(swarm, request.lanes)
    });
  }),
  "swarm.hasOwnLanes": refusable((session) => dbSwarmBackend.hasOwnLanes(runRef(session))),
  "swarm.loadAutoCheckFiles": refusable((session) => dbSwarmBackend.loadAutoCheckFiles(runRef(session))),
  "swarm.loadCheckInputs": refusable(async (session, args) => {
    const { leafMessageId = null } = input<{ leafMessageId?: string | null }>(args);
    await assertOwnMessage(session.taskId, leafMessageId);
    return dbSwarmBackend.loadCheckInputs(runRef(session), leafMessageId);
  }),
  "swarm.startCheckLane": refusable(async (session, args) => {
    const swarm = requireSwarm(session);
    assertRole(session, CHECK_TOOL_NAME);
    const request = input<{ laneTaskId?: unknown; brief?: unknown; capabilities?: ForkSeedCapabilities; focus?: unknown; modelRoute?: ChosenModelRoute | null }>(args);
    if (typeof request.laneTaskId !== "string" || !UUID.test(request.laneTaskId)) invalid("A Check lane needs its id.");
    if (typeof request.brief !== "string" || !request.capabilities) invalid("A Check lane needs its brief.");
    if (swarm.context.lane && !await dbSwarmBackend.hasOwnLanes(runRef(session))) {
      throw new SwarmToolError("Only the leader and lanes that have lanes of their own can start a check. Submit your part instead.");
    }
    return dbSwarmBackend.startCheckLane(runRef(session), {
      laneTaskId: request.laneTaskId,
      brief: request.brief,
      capabilities: withAdmittedRuntime(swarm, { capabilities: request.capabilities }).capabilities,
      focus: typeof request.focus === "string" ? request.focus : null,
      modelRoute: checkedRoute(swarm, request.modelRoute)
    });
  }),
  "swarm.steerLane": refusable(async (session, args) => {
    assertRole(session, STEER_TOOL_NAME);
    const { laneTaskId, message } = input<{ laneTaskId?: unknown; message?: unknown }>(args);
    if (typeof laneTaskId !== "string" || typeof message !== "string") invalid("steer needs a lane and a message.");
    await dbSwarmBackend.steerLane(runRef(session), { laneTaskId, message });
  }),
  "swarm.stopLane": refusable(async (session, args) => {
    assertRole(session, STOP_LANE_TOOL_NAME);
    const { laneTaskId, discard } = input<{ laneTaskId?: unknown; discard?: unknown }>(args);
    if (typeof laneTaskId !== "string") invalid("stop needs a lane.");
    await dbSwarmBackend.stopLane(runRef(session), { laneTaskId, discard: discard === true });
  }),
  "swarm.resumeLane": refusable(async (session, args) => {
    assertRole(session, RESUME_TOOL_NAME);
    const { laneTaskId, message, extraTokens } = input<{ laneTaskId?: unknown; message?: unknown; extraTokens?: unknown }>(args);
    if (typeof laneTaskId !== "string" || typeof message !== "string") invalid("resume needs a lane and a message.");
    const extra = typeof extraTokens === "number" && Number.isSafeInteger(extraTokens) && extraTokens > 0 ? extraTokens : null;
    return dbSwarmBackend.resumeLane(runRef(session), { laneTaskId, message, extraTokens: extra });
  }),
  "swarm.shareNote": refusable(async (session, args) => {
    assertRole(session, SHARE_TOOL_NAME);
    const { text } = input<{ text?: unknown }>(args);
    if (typeof text !== "string" || text.length === 0 || text.length > 2_000) invalid("A note is up to 2,000 characters.");
    await dbSwarmBackend.shareNote(runRef(session), text);
  }),
  "swarm.emitEvent": refusable(async (session, args) => {
    const { message } = input<{ message?: unknown }>(args);
    if (typeof message !== "string") invalid("An event needs a message.");
    await dbSwarmBackend.emitEvent(runRef(session), message.slice(0, 500));
  }),
  // The run ends here; the job it resumes with is the one the control plane admitted.
  "swarm.park": refusable(async (session, args) => {
    const swarm = requireSwarm(session);
    const { leafMessageId = null, reason } = input<{ leafMessageId?: string | null; reason?: unknown }>(args);
    if (reason !== "lanes" && reason !== "check" && reason !== "resume") invalid("Invalid park reason.");
    await assertOwnMessage(session.taskId, leafMessageId);
    await dbSwarmBackend.park(runRef(session), {
      job: { ...swarm.job, branchMessageId: leafMessageId ?? undefined },
      leafMessageId,
      reason
    });
  }),
  "swarm.finishLane": refusable(async (session, args) => {
    assertRole(session, SUBMIT_TOOL_NAME);
    const { status, result } = input<{ status?: unknown; result?: SwarmLaneResult }>(args);
    if (status !== "done" && status !== "failed") invalid("A lane finishes done or failed.");
    if (!result || typeof result.summary !== "string" || !Array.isArray(result.files)) invalid("A lane needs its result.");
    await dbSwarmBackend.finishLane(runRef(session), { runId: session.runId, status, result });
  })
};

// Calls after which the run has ended on the control plane.
export const SWARM_RUN_ENDING_METHODS: readonly SwarmMethod[] = ["swarm.park", "swarm.finishLane"];

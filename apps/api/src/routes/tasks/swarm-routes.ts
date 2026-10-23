import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import type { AgentSwarmNoteView, AgentSwarmView } from "@meowbert/shared";
import { requestAgentSwarmLaneStop } from "../../services/agent-swarm/lane-stop.js";
import { loadAgentSwarmNotes, loadAgentSwarmView } from "../../services/agent-swarm/lanes-read.js";
import { assertTaskMember } from "../../services/workspaces/workspace-access.js";
import { taskParams } from "./shared.js";

const notesQuery = z.object({ after: z.string().regex(/^\d+$/).optional() });
const laneParams = taskParams.extend({ laneId: z.string().uuid() });
const stopBody = z.object({ discard: z.boolean() });

async function handleGetSwarm(request: FastifyRequest): Promise<{ swarm: AgentSwarmView | null }> {
  const params = taskParams.parse(request.params);
  await assertTaskMember(params.taskId, request.user.id);
  return { swarm: await loadAgentSwarmView(params.taskId) };
}

async function handleGetSwarmNotes(request: FastifyRequest): Promise<{ notes: AgentSwarmNoteView[] }> {
  const params = taskParams.parse(request.params);
  const { after } = notesQuery.parse(request.query ?? {});
  await assertTaskMember(params.taskId, request.user.id);
  return { notes: await loadAgentSwarmNotes(params.taskId, after ?? null) };
}

// The same as the stop tool, for the user; steering goes through the leader as a normal message.
async function handleStopLane(request: FastifyRequest): Promise<{ ok: true }> {
  const params = laneParams.parse(request.params);
  const body = stopBody.parse(request.body ?? {});
  await assertTaskMember(params.taskId, request.user.id);
  await requestAgentSwarmLaneStop({ swarmTaskId: params.taskId, laneTaskId: params.laneId, discard: body.discard });
  return { ok: true };
}

export async function registerTaskSwarmRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get("/api/tasks/:taskId/swarm", { preHandler: fastify.authenticate }, handleGetSwarm);
  fastify.get("/api/tasks/:taskId/swarm/notes", { preHandler: fastify.authenticate }, handleGetSwarmNotes);
  fastify.post("/api/tasks/:taskId/swarm/lanes/:laneId/stop", { preHandler: fastify.authenticate }, handleStopLane);
}

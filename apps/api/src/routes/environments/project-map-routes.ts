import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  createProjectMapCard,
  deleteProjectMapCard,
  loadProjectMap,
  moveProjectMapItems,
  PROJECT_MAP_CARD_STATES,
  recordProjectMapChange,
  setProjectBrief,
  setProjectFolderNote,
  updateProjectMapCard,
  type ProjectMapDb
} from "@meowbert/shared";
import { pool, withTransaction } from "../../lib/db.js";
import { describeCard, describeFolder, describeMapItems } from "../../services/project-map/map-change-summaries.js";
import { assertEnvironmentMember } from "../../services/workspaces/workspace-access.js";
import { environmentEntityPaths, environmentParams } from "./shared.js";

const folderParams = environmentParams.extend({ folderId: z.string().uuid() });
const cardParams = environmentParams.extend({ cardId: z.string().uuid() });
const noteBody = z.object({ markdown: z.string() }).strict();
const cardBody = z.object({
  folderId: z.string().uuid().nullable(),
  title: z.string(),
  body: z.string().default(""),
  state: z.enum(PROJECT_MAP_CARD_STATES).default("idea")
}).strict();
const cardPatchBody = z.object({
  title: z.string().nullable().default(null),
  body: z.string().nullable().default(null),
  state: z.enum(PROJECT_MAP_CARD_STATES).nullable().default(null)
}).strict();
const moveBody = z.object({ ids: z.array(z.string().uuid()).min(1).max(500), folderId: z.string().uuid().nullable() }).strict();

// Applies a member's edit and queues a note for the Master in the same transaction.
async function editMap<T>(
  request: FastifyRequest,
  environmentId: string,
  edit: (db: ProjectMapDb) => Promise<{ result: T; summary: string }>
): Promise<T> {
  return withTransaction(async (client) => {
    const { result, summary } = await edit(client);
    await recordProjectMapChange(client, { environmentId, actorUserId: request.user.id, summary });
    return result;
  });
}

async function handleGetMap(request: FastifyRequest) {
  const params = environmentParams.parse(request.params);
  await assertEnvironmentMember(params.envId, request.user.id);
  return loadProjectMap(pool, params.envId);
}

async function handleSetBrief(request: FastifyRequest) {
  const params = environmentParams.parse(request.params);
  const body = noteBody.parse(request.body);
  await assertEnvironmentMember(params.envId, request.user.id);
  return editMap(request, params.envId, async (db) => {
    await setProjectBrief(db, params.envId, body.markdown);
    return { result: { ok: true }, summary: "edited the project brief" };
  });
}

async function handleSetFolderNote(request: FastifyRequest) {
  const params = folderParams.parse(request.params);
  const body = noteBody.parse(request.body);
  await assertEnvironmentMember(params.envId, request.user.id);
  return editMap(request, params.envId, async (db) => {
    await setProjectFolderNote(db, params.envId, params.folderId, body.markdown);
    return { result: { ok: true }, summary: `edited the note on ${await describeFolder(db, params.folderId)}` };
  });
}

async function handleCreateCard(request: FastifyRequest) {
  const params = environmentParams.parse(request.params);
  const body = cardBody.parse(request.body);
  const access = await assertEnvironmentMember(params.envId, request.user.id);
  return editMap(request, params.envId, async (db) => {
    const id = await createProjectMapCard(db, { workspaceId: access.workspaceId, environmentId: params.envId, ...body });
    return { result: { id }, summary: `added ${await describeCard(db, id)} (${body.state}) in ${await describeFolder(db, body.folderId)}` };
  });
}

async function handleUpdateCard(request: FastifyRequest) {
  const params = cardParams.parse(request.params);
  const body = cardPatchBody.parse(request.body);
  await assertEnvironmentMember(params.envId, request.user.id);
  return editMap(request, params.envId, async (db) => {
    await updateProjectMapCard(db, params.envId, params.cardId, body);
    const stateNote = body.state ? `, now ${body.state}` : "";
    return { result: { ok: true }, summary: `edited ${await describeCard(db, params.cardId)}${stateNote}` };
  });
}

async function handleDeleteCard(request: FastifyRequest) {
  const params = cardParams.parse(request.params);
  await assertEnvironmentMember(params.envId, request.user.id);
  return editMap(request, params.envId, async (db) => {
    const described = await describeCard(db, params.cardId);
    await deleteProjectMapCard(db, params.envId, params.cardId);
    return { result: { ok: true }, summary: `deleted ${described}` };
  });
}

async function handleMove(request: FastifyRequest) {
  const params = environmentParams.parse(request.params);
  const body = moveBody.parse(request.body);
  await assertEnvironmentMember(params.envId, request.user.id);
  return editMap(request, params.envId, async (db) => {
    const moved = await moveProjectMapItems(db, params.envId, body.ids, body.folderId);
    return { result: moved, summary: `moved ${await describeMapItems(db, body.ids)} into ${await describeFolder(db, body.folderId)}` };
  });
}

export async function registerEnvironmentProjectMapRoutes(fastify: FastifyInstance): Promise<void> {
  const auth = { preHandler: fastify.authenticate };
  for (const environmentPath of environmentEntityPaths) {
    fastify.get(`${environmentPath}/map`, auth, handleGetMap);
    fastify.put(`${environmentPath}/map/brief`, auth, handleSetBrief);
    fastify.put(`${environmentPath}/map/folders/:folderId/note`, auth, handleSetFolderNote);
    fastify.post(`${environmentPath}/map/cards`, auth, handleCreateCard);
    fastify.patch(`${environmentPath}/map/cards/:cardId`, auth, handleUpdateCard);
    fastify.delete(`${environmentPath}/map/cards/:cardId`, auth, handleDeleteCard);
    fastify.post(`${environmentPath}/map/move`, auth, handleMove);
  }
}

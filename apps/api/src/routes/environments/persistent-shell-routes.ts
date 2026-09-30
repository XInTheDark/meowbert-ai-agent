import { z } from "zod";
import type { FastifyInstance } from "fastify";
import {
  listPersistentShellSessions,
  terminatePersistentShellSessions
} from "../../services/runtime/persistent-shell-sessions.js";
import { assertTaskMember } from "../../services/workspaces/workspace-access.js";
import { environmentParams, getEnvironmentForUser } from "./shared.js";
import { taskParams } from "../tasks/shared.js";

const persistentShellQuery = z.object({
  includeOutput: z.coerce.boolean().optional().default(false),
  outputTailLines: z.coerce.number().int().min(1).max(2_000).optional()
});

const environmentShellSessionParams = environmentParams.extend({
  sessionId: z.string().uuid()
});

const taskShellSessionParams = taskParams.extend({
  sessionId: z.string().uuid()
});

export async function registerEnvironmentPersistentShellRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get(
    "/api/projects/:envId/persistent-shell-sessions",
    { preHandler: fastify.authenticate },
    async (request) => {
      const params = environmentParams.parse(request.params);
      const options = persistentShellQuery.parse(request.query);
      await getEnvironmentForUser(params.envId, request.user.id);

      return {
        items: await listPersistentShellSessions({
          environmentId: params.envId,
          includeOutput: options.includeOutput,
          outputTailLines: options.outputTailLines
        })
      };
    }
  );

  fastify.post(
    "/api/projects/:envId/persistent-shell-sessions/terminate-all",
    { preHandler: fastify.authenticate },
    async (request) => {
      const params = environmentParams.parse(request.params);
      await getEnvironmentForUser(params.envId, request.user.id);

      return {
        terminated: await terminatePersistentShellSessions({ environmentId: params.envId })
      };
    }
  );

  fastify.post(
    "/api/projects/:envId/persistent-shell-sessions/:sessionId/terminate",
    { preHandler: fastify.authenticate },
    async (request) => {
      const params = environmentShellSessionParams.parse(request.params);
      await getEnvironmentForUser(params.envId, request.user.id);

      return {
        terminated: await terminatePersistentShellSessions({
          environmentId: params.envId,
          sessionId: params.sessionId
        })
      };
    }
  );

  fastify.get(
    "/api/tasks/:taskId/persistent-shell-sessions",
    { preHandler: fastify.authenticate },
    async (request) => {
      const params = taskParams.parse(request.params);
      const options = persistentShellQuery.parse(request.query);
      await assertTaskMember(params.taskId, request.user.id);

      return {
        items: await listPersistentShellSessions({
          taskId: params.taskId,
          includeOutput: options.includeOutput,
          outputTailLines: options.outputTailLines
        })
      };
    }
  );

  fastify.post(
    "/api/tasks/:taskId/persistent-shell-sessions/terminate-all",
    { preHandler: fastify.authenticate },
    async (request) => {
      const params = taskParams.parse(request.params);
      await assertTaskMember(params.taskId, request.user.id);

      return {
        terminated: await terminatePersistentShellSessions({ taskId: params.taskId })
      };
    }
  );

  fastify.post(
    "/api/tasks/:taskId/persistent-shell-sessions/:sessionId/terminate",
    { preHandler: fastify.authenticate },
    async (request) => {
      const params = taskShellSessionParams.parse(request.params);
      await assertTaskMember(params.taskId, request.user.id);

      return {
        terminated: await terminatePersistentShellSessions({
          taskId: params.taskId,
          sessionId: params.sessionId
        })
      };
    }
  );
}

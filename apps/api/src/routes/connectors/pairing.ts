import { z } from "zod";
import type { FastifyPluginAsync } from "fastify";
import { query } from "../../lib/db.js";
import { createConnectorPairCode, pairingInstructionsForConnector } from "../../services/connectors/connector-pairing.js";
import { assertWorkspaceMember } from "../../services/workspaces/workspace-access.js";

export const pairingRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post(
    "/api/workspaces/:wsId/connectors/:connectorType/pair",
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const params = z
        .object({
          wsId: z.string().uuid(),
          connectorType: z.enum(["telegram", "discord", "github"])
        })
        .parse(request.params);

      await assertWorkspaceMember(params.wsId, request.user.id);

      const bindingRes = await query<{ id: string; status: string }>(
        `SELECT id, status
           FROM connector_bindings
          WHERE workspace_id = $1
            AND type = $2
          LIMIT 1`,
        [params.wsId, params.connectorType]
      );

      if ((bindingRes.rowCount ?? 0) === 0) {
        return reply.status(404).send({
          error: `No ${params.connectorType} connector is configured for this workspace yet`
        });
      }

      const binding = bindingRes.rows[0];
      if (binding.status !== "active") {
        return reply.status(409).send({
          error: `${params.connectorType} connector is not active yet`
        });
      }

      const pairCode = await createConnectorPairCode({
        bindingId: binding.id,
        workspaceId: params.wsId,
        userId: request.user.id
      });

      return reply.send({
        connectorType: params.connectorType,
        code: pairCode.code,
        expiresAt: pairCode.expiresAt,
        instructions: pairingInstructionsForConnector(params.connectorType)
      });
    }
  );
};

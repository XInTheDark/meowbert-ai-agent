import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import type WebSocket from "ws";
import { issueScopedAccessTicket, verifyScopedAccessTicket } from "../services/auth/scoped-access-tickets.js";
import {
  ensureDesktopComputerBrokerStarted,
  registerDesktopComputerConnection
} from "../services/runtime/desktop-computer.js";

export const desktopRoutes: FastifyPluginAsync = async (fastify) => {
  await ensureDesktopComputerBrokerStarted(fastify.log);

  const desktopStreamTicketQuery = z.object({
    ticket: z.string().min(1)
  });

  fastify.post(
    "/api/desktop/computer/stream-ticket",
    { preHandler: fastify.authenticate },
    async (request) => issueScopedAccessTicket(fastify, {
      scope: "desktop_computer_stream",
      userId: request.user.id
    })
  );

  const authenticateDesktopStream = async (request: FastifyRequest, reply: FastifyReply) => {
    const queryInput = desktopStreamTicketQuery.parse(request.query ?? {});

    try {
      const payload = await verifyScopedAccessTicket(fastify, {
        ticket: queryInput.ticket,
        scope: "desktop_computer_stream"
      });
      request.user = {
        id: payload.userId,
        email: ""
      };
    } catch {
      return reply.status(401).send({ error: "Unauthorized" });
    }
  };

  fastify.get(
    "/api/desktop/computer/stream",
    {
      websocket: true,
      preHandler: authenticateDesktopStream
    },
    (connection, request) => {
      const socket = connection as WebSocket;
      registerDesktopComputerConnection({
        userId: request.user.id,
        socket,
        logger: fastify.log
      });
      if (socket.readyState === socket.OPEN) {
        socket.send(JSON.stringify({ type: "ready", connectedAt: new Date().toISOString() }));
      }
    }
  );
};

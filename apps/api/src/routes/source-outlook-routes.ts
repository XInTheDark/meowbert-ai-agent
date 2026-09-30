import { z } from "zod";
import type { FastifyPluginAsync } from "fastify";
import { ScopedAccessTicketError } from "../services/auth/scoped-access-tickets.js";
import {
  createWorkspaceOutlookCalendarEvent,
  deleteWorkspaceOutlookCalendarEvent,
  listWorkspaceOutlookCalendars,
  readWorkspaceOutlookCalendarEvent,
  readWorkspaceOutlookMessage,
  searchWorkspaceOutlookCalendarEvents,
  searchWorkspaceOutlookMessages,
  updateWorkspaceOutlookCalendarEvent,
  viewWorkspaceOutlookCalendar
} from "../services/sources/outlook-operations.js";
import { assertWorkspaceMember } from "../services/workspaces/workspace-access.js";
import {
  extractBearerToken,
  requireSourceProxyAccess,
  sourceParams,
  sourceSearchQuery
} from "./source-route-shared.js";
import {
  normalizeOutlookCreateEventInput,
  normalizeOutlookUpdateEventInput,
  outlookCalendarSearchQuery,
  outlookCalendarViewQuery,
  outlookCalendarsQuery,
  outlookCreateEventRequestBody,
  outlookDeleteEventByIdQuery,
  outlookDeleteEventQuery,
  outlookEventReadByIdQuery,
  outlookEventReadQuery,
  outlookMessageReadByIdQuery,
  outlookMessageReadQuery,
  outlookUpdateEventRequestBody
} from "./source-outlook-schemas.js";

function registerWorkspaceOutlookMessageRoutes(fastify: Parameters<FastifyPluginAsync>[0]): void {
  fastify.get(
    "/api/workspaces/:wsId/sources/:sourceId/outlook/messages/search",
    { preHandler: fastify.authenticate },
    async (request) => {
      const params = sourceParams.parse(request.params);
      const queryInput = sourceSearchQuery.parse(request.query ?? {});
      await assertWorkspaceMember(params.wsId, request.user.id);

      return searchWorkspaceOutlookMessages({
        workspaceId: params.wsId,
        sourceId: params.sourceId,
        query: queryInput.q,
        limit: queryInput.limit
      });
    }
  );

  fastify.get(
    "/api/workspaces/:wsId/sources/:sourceId/outlook/messages/:messageId",
    { preHandler: fastify.authenticate },
    async (request) => {
      const params = sourceParams.extend({ messageId: z.string().min(1).max(1200) }).parse(request.params);
      const queryInput = outlookMessageReadQuery.parse(request.query ?? {});
      await assertWorkspaceMember(params.wsId, request.user.id);

      return readWorkspaceOutlookMessage({
        workspaceId: params.wsId,
        sourceId: params.sourceId,
        messageId: params.messageId,
        bodyFormat: queryInput.bodyFormat ?? null
      });
    }
  );

  fastify.get(
    "/api/workspaces/:wsId/sources/:sourceId/outlook/messages/item",
    { preHandler: fastify.authenticate },
    async (request) => {
      const params = sourceParams.parse(request.params);
      const queryInput = outlookMessageReadByIdQuery.parse(request.query ?? {});
      await assertWorkspaceMember(params.wsId, request.user.id);

      return readWorkspaceOutlookMessage({
        workspaceId: params.wsId,
        sourceId: params.sourceId,
        messageId: queryInput.messageId,
        bodyFormat: queryInput.bodyFormat ?? null
      });
    }
  );
}

function registerWorkspaceOutlookCalendarReadRoutes(fastify: Parameters<FastifyPluginAsync>[0]): void {
  fastify.get(
    "/api/workspaces/:wsId/sources/:sourceId/outlook/calendars",
    { preHandler: fastify.authenticate },
    async (request) => {
      const params = sourceParams.parse(request.params);
      const queryInput = outlookCalendarsQuery.parse(request.query ?? {});
      await assertWorkspaceMember(params.wsId, request.user.id);

      return listWorkspaceOutlookCalendars({
        workspaceId: params.wsId,
        sourceId: params.sourceId,
        limit: queryInput.limit
      });
    }
  );

  fastify.get(
    "/api/workspaces/:wsId/sources/:sourceId/outlook/calendars/search",
    { preHandler: fastify.authenticate },
    async (request) => {
      const params = sourceParams.parse(request.params);
      const queryInput = outlookCalendarSearchQuery.parse(request.query ?? {});
      await assertWorkspaceMember(params.wsId, request.user.id);

      return searchWorkspaceOutlookCalendarEvents({
        workspaceId: params.wsId,
        sourceId: params.sourceId,
        query: queryInput.q,
        calendarId: queryInput.calendarId ?? null,
        limit: queryInput.limit
      });
    }
  );

  fastify.get(
    "/api/workspaces/:wsId/sources/:sourceId/outlook/calendars/view",
    { preHandler: fastify.authenticate },
    async (request) => {
      const params = sourceParams.parse(request.params);
      const queryInput = outlookCalendarViewQuery.parse(request.query ?? {});
      await assertWorkspaceMember(params.wsId, request.user.id);

      return viewWorkspaceOutlookCalendar({
        workspaceId: params.wsId,
        sourceId: params.sourceId,
        calendarId: queryInput.calendarId ?? null,
        startDateTime: queryInput.startDateTime,
        endDateTime: queryInput.endDateTime,
        timezone: queryInput.timezone ?? null,
        limit: queryInput.limit
      });
    }
  );

  fastify.get(
    "/api/workspaces/:wsId/sources/:sourceId/outlook/events/:eventId",
    { preHandler: fastify.authenticate },
    async (request) => {
      const params = sourceParams.extend({ eventId: z.string().min(1).max(1200) }).parse(request.params);
      const queryInput = outlookEventReadQuery.parse(request.query ?? {});
      await assertWorkspaceMember(params.wsId, request.user.id);

      return readWorkspaceOutlookCalendarEvent({
        workspaceId: params.wsId,
        sourceId: params.sourceId,
        eventId: params.eventId,
        calendarId: queryInput.calendarId ?? null,
        timezone: queryInput.timezone ?? null,
        bodyFormat: queryInput.bodyFormat ?? null
      });
    }
  );

  fastify.get(
    "/api/workspaces/:wsId/sources/:sourceId/outlook/events/item",
    { preHandler: fastify.authenticate },
    async (request) => {
      const params = sourceParams.parse(request.params);
      const queryInput = outlookEventReadByIdQuery.parse(request.query ?? {});
      await assertWorkspaceMember(params.wsId, request.user.id);

      return readWorkspaceOutlookCalendarEvent({
        workspaceId: params.wsId,
        sourceId: params.sourceId,
        eventId: queryInput.eventId,
        calendarId: queryInput.calendarId ?? null,
        timezone: queryInput.timezone ?? null,
        bodyFormat: queryInput.bodyFormat ?? null
      });
    }
  );
}

function registerWorkspaceOutlookCalendarMutationRoutes(fastify: Parameters<FastifyPluginAsync>[0]): void {
  fastify.post(
    "/api/workspaces/:wsId/sources/:sourceId/outlook/events",
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const params = sourceParams.parse(request.params);
      const body = outlookCreateEventRequestBody.parse(request.body ?? {});
      await assertWorkspaceMember(params.wsId, request.user.id);

      const event = await createWorkspaceOutlookCalendarEvent({
        workspaceId: params.wsId,
        sourceId: params.sourceId,
        timezone: body.timezone ?? null,
        bodyFormat: body.bodyFormat ?? null,
        event: normalizeOutlookCreateEventInput(body.event)
      });

      return reply.status(201).send({ event });
    }
  );

  fastify.patch(
    "/api/workspaces/:wsId/sources/:sourceId/outlook/events/:eventId",
    { preHandler: fastify.authenticate },
    async (request) => {
      const params = sourceParams.extend({ eventId: z.string().min(1).max(1200) }).parse(request.params);
      const body = outlookUpdateEventRequestBody.parse(request.body ?? {});
      await assertWorkspaceMember(params.wsId, request.user.id);

      return {
        event: await updateWorkspaceOutlookCalendarEvent({
          workspaceId: params.wsId,
          sourceId: params.sourceId,
          eventId: params.eventId,
          timezone: body.timezone ?? null,
          bodyFormat: body.bodyFormat ?? null,
          event: normalizeOutlookUpdateEventInput(body.event)
        })
      };
    }
  );

  fastify.patch(
    "/api/workspaces/:wsId/sources/:sourceId/outlook/events/item",
    { preHandler: fastify.authenticate },
    async (request) => {
      const params = sourceParams.parse(request.params);
      const queryInput = z.object({ eventId: z.string().trim().min(1).max(1200) }).parse(request.query ?? {});
      const body = outlookUpdateEventRequestBody.parse(request.body ?? {});
      await assertWorkspaceMember(params.wsId, request.user.id);

      return {
        event: await updateWorkspaceOutlookCalendarEvent({
          workspaceId: params.wsId,
          sourceId: params.sourceId,
          eventId: queryInput.eventId,
          timezone: body.timezone ?? null,
          bodyFormat: body.bodyFormat ?? null,
          event: normalizeOutlookUpdateEventInput(body.event)
        })
      };
    }
  );

  fastify.delete(
    "/api/workspaces/:wsId/sources/:sourceId/outlook/events/:eventId",
    { preHandler: fastify.authenticate },
    async (request) => {
      const params = sourceParams.extend({ eventId: z.string().min(1).max(1200) }).parse(request.params);
      const queryInput = outlookDeleteEventQuery.parse(request.query ?? {});
      await assertWorkspaceMember(params.wsId, request.user.id);

      return deleteWorkspaceOutlookCalendarEvent({
        workspaceId: params.wsId,
        sourceId: params.sourceId,
        eventId: params.eventId,
        calendarId: queryInput.calendarId ?? null,
        expectedChangeKey: queryInput.expectedChangeKey,
        confirmAttendeeCancellation: queryInput.confirmAttendeeCancellation
      });
    }
  );

  fastify.delete(
    "/api/workspaces/:wsId/sources/:sourceId/outlook/events/item",
    { preHandler: fastify.authenticate },
    async (request) => {
      const params = sourceParams.parse(request.params);
      const queryInput = outlookDeleteEventByIdQuery.parse(request.query ?? {});
      await assertWorkspaceMember(params.wsId, request.user.id);

      return deleteWorkspaceOutlookCalendarEvent({
        workspaceId: params.wsId,
        sourceId: params.sourceId,
        eventId: queryInput.eventId,
        calendarId: queryInput.calendarId ?? null,
        expectedChangeKey: queryInput.expectedChangeKey,
        confirmAttendeeCancellation: queryInput.confirmAttendeeCancellation
      });
    }
  );
}

function registerWorkspaceOutlookRoutes(fastify: Parameters<FastifyPluginAsync>[0]): void {
  registerWorkspaceOutlookMessageRoutes(fastify);
  registerWorkspaceOutlookCalendarReadRoutes(fastify);
  registerWorkspaceOutlookCalendarMutationRoutes(fastify);
}

function registerInternalOutlookMessageRoutes(fastify: Parameters<FastifyPluginAsync>[0]): void {
  fastify.get("/api/internal/sources/:sourceId/outlook/messages/search", async (request) => {
    const params = z.object({ sourceId: z.string().min(1).max(120) }).parse(request.params);
    const queryInput = sourceSearchQuery.parse(request.query ?? {});
    const ticket = extractBearerToken(request.headers.authorization);
    const payload = await requireSourceProxyAccess({ fastify, ticket, sourceId: params.sourceId });
    if (!payload.workspaceId) {
      throw new ScopedAccessTicketError();
    }

    return searchWorkspaceOutlookMessages({
      workspaceId: payload.workspaceId,
      sourceId: params.sourceId,
      query: queryInput.q,
      limit: queryInput.limit
    });
  });

  fastify.get("/api/internal/sources/:sourceId/outlook/messages/:messageId", async (request) => {
    const params = z.object({ sourceId: z.string().min(1).max(120), messageId: z.string().min(1).max(1200) }).parse(request.params);
    const queryInput = outlookMessageReadQuery.parse(request.query ?? {});
    const ticket = extractBearerToken(request.headers.authorization);
    const payload = await requireSourceProxyAccess({ fastify, ticket, sourceId: params.sourceId });
    if (!payload.workspaceId) {
      throw new ScopedAccessTicketError();
    }

    return readWorkspaceOutlookMessage({
      workspaceId: payload.workspaceId,
      sourceId: params.sourceId,
      messageId: params.messageId,
      bodyFormat: queryInput.bodyFormat ?? null
    });
  });

  fastify.get("/api/internal/sources/:sourceId/outlook/messages/item", async (request) => {
    const params = z.object({ sourceId: z.string().min(1).max(120) }).parse(request.params);
    const queryInput = outlookMessageReadByIdQuery.parse(request.query ?? {});
    const ticket = extractBearerToken(request.headers.authorization);
    const payload = await requireSourceProxyAccess({ fastify, ticket, sourceId: params.sourceId });
    if (!payload.workspaceId) {
      throw new ScopedAccessTicketError();
    }

    return readWorkspaceOutlookMessage({
      workspaceId: payload.workspaceId,
      sourceId: params.sourceId,
      messageId: queryInput.messageId,
      bodyFormat: queryInput.bodyFormat ?? null
    });
  });
}

function registerInternalOutlookCalendarReadRoutes(fastify: Parameters<FastifyPluginAsync>[0]): void {
  fastify.get("/api/internal/sources/:sourceId/outlook/calendars", async (request) => {
    const params = z.object({ sourceId: z.string().min(1).max(120) }).parse(request.params);
    const queryInput = outlookCalendarsQuery.parse(request.query ?? {});
    const ticket = extractBearerToken(request.headers.authorization);
    const payload = await requireSourceProxyAccess({ fastify, ticket, sourceId: params.sourceId });
    if (!payload.workspaceId) {
      throw new ScopedAccessTicketError();
    }

    return listWorkspaceOutlookCalendars({
      workspaceId: payload.workspaceId,
      sourceId: params.sourceId,
      limit: queryInput.limit
    });
  });

  fastify.get("/api/internal/sources/:sourceId/outlook/calendars/search", async (request) => {
    const params = z.object({ sourceId: z.string().min(1).max(120) }).parse(request.params);
    const queryInput = outlookCalendarSearchQuery.parse(request.query ?? {});
    const ticket = extractBearerToken(request.headers.authorization);
    const payload = await requireSourceProxyAccess({ fastify, ticket, sourceId: params.sourceId });
    if (!payload.workspaceId) {
      throw new ScopedAccessTicketError();
    }

    return searchWorkspaceOutlookCalendarEvents({
      workspaceId: payload.workspaceId,
      sourceId: params.sourceId,
      query: queryInput.q,
      calendarId: queryInput.calendarId ?? null,
      limit: queryInput.limit
    });
  });

  fastify.get("/api/internal/sources/:sourceId/outlook/calendars/view", async (request) => {
    const params = z.object({ sourceId: z.string().min(1).max(120) }).parse(request.params);
    const queryInput = outlookCalendarViewQuery.parse(request.query ?? {});
    const ticket = extractBearerToken(request.headers.authorization);
    const payload = await requireSourceProxyAccess({ fastify, ticket, sourceId: params.sourceId });
    if (!payload.workspaceId) {
      throw new ScopedAccessTicketError();
    }

    return viewWorkspaceOutlookCalendar({
      workspaceId: payload.workspaceId,
      sourceId: params.sourceId,
      calendarId: queryInput.calendarId ?? null,
      startDateTime: queryInput.startDateTime,
      endDateTime: queryInput.endDateTime,
      timezone: queryInput.timezone ?? null,
      limit: queryInput.limit
    });
  });

  fastify.get("/api/internal/sources/:sourceId/outlook/events/:eventId", async (request) => {
    const params = z.object({ sourceId: z.string().min(1).max(120), eventId: z.string().min(1).max(1200) }).parse(request.params);
    const queryInput = outlookEventReadQuery.parse(request.query ?? {});
    const ticket = extractBearerToken(request.headers.authorization);
    const payload = await requireSourceProxyAccess({ fastify, ticket, sourceId: params.sourceId });
    if (!payload.workspaceId) {
      throw new ScopedAccessTicketError();
    }

    return readWorkspaceOutlookCalendarEvent({
      workspaceId: payload.workspaceId,
      sourceId: params.sourceId,
      eventId: params.eventId,
      calendarId: queryInput.calendarId ?? null,
      timezone: queryInput.timezone ?? null,
      bodyFormat: queryInput.bodyFormat ?? null
    });
  });

  fastify.get("/api/internal/sources/:sourceId/outlook/events/item", async (request) => {
    const params = z.object({ sourceId: z.string().min(1).max(120) }).parse(request.params);
    const queryInput = outlookEventReadByIdQuery.parse(request.query ?? {});
    const ticket = extractBearerToken(request.headers.authorization);
    const payload = await requireSourceProxyAccess({ fastify, ticket, sourceId: params.sourceId });
    if (!payload.workspaceId) {
      throw new ScopedAccessTicketError();
    }

    return readWorkspaceOutlookCalendarEvent({
      workspaceId: payload.workspaceId,
      sourceId: params.sourceId,
      eventId: queryInput.eventId,
      calendarId: queryInput.calendarId ?? null,
      timezone: queryInput.timezone ?? null,
      bodyFormat: queryInput.bodyFormat ?? null
    });
  });
}

function registerInternalOutlookCalendarMutationRoutes(fastify: Parameters<FastifyPluginAsync>[0]): void {
  fastify.post("/api/internal/sources/:sourceId/outlook/events", async (request) => {
    const params = z.object({ sourceId: z.string().min(1).max(120) }).parse(request.params);
    const body = outlookCreateEventRequestBody.parse(request.body ?? {});
    const ticket = extractBearerToken(request.headers.authorization);
    const payload = await requireSourceProxyAccess({ fastify, ticket, sourceId: params.sourceId });
    if (!payload.workspaceId) {
      throw new ScopedAccessTicketError();
    }

    return {
      event: await createWorkspaceOutlookCalendarEvent({
        workspaceId: payload.workspaceId,
        sourceId: params.sourceId,
        timezone: body.timezone ?? null,
        bodyFormat: body.bodyFormat ?? null,
        event: normalizeOutlookCreateEventInput(body.event)
      })
    };
  });

  fastify.patch("/api/internal/sources/:sourceId/outlook/events/:eventId", async (request) => {
    const params = z.object({ sourceId: z.string().min(1).max(120), eventId: z.string().min(1).max(1200) }).parse(request.params);
    const body = outlookUpdateEventRequestBody.parse(request.body ?? {});
    const ticket = extractBearerToken(request.headers.authorization);
    const payload = await requireSourceProxyAccess({ fastify, ticket, sourceId: params.sourceId });
    if (!payload.workspaceId) {
      throw new ScopedAccessTicketError();
    }

    return {
      event: await updateWorkspaceOutlookCalendarEvent({
        workspaceId: payload.workspaceId,
        sourceId: params.sourceId,
        eventId: params.eventId,
        timezone: body.timezone ?? null,
        bodyFormat: body.bodyFormat ?? null,
        event: normalizeOutlookUpdateEventInput(body.event)
      })
    };
  });

  fastify.patch("/api/internal/sources/:sourceId/outlook/events/item", async (request) => {
    const params = z.object({ sourceId: z.string().min(1).max(120) }).parse(request.params);
    const queryInput = z.object({ eventId: z.string().trim().min(1).max(1200) }).parse(request.query ?? {});
    const body = outlookUpdateEventRequestBody.parse(request.body ?? {});
    const ticket = extractBearerToken(request.headers.authorization);
    const payload = await requireSourceProxyAccess({ fastify, ticket, sourceId: params.sourceId });
    if (!payload.workspaceId) {
      throw new ScopedAccessTicketError();
    }

    return {
      event: await updateWorkspaceOutlookCalendarEvent({
        workspaceId: payload.workspaceId,
        sourceId: params.sourceId,
        eventId: queryInput.eventId,
        timezone: body.timezone ?? null,
        bodyFormat: body.bodyFormat ?? null,
        event: normalizeOutlookUpdateEventInput(body.event)
      })
    };
  });

  fastify.delete("/api/internal/sources/:sourceId/outlook/events/:eventId", async (request) => {
    const params = z.object({ sourceId: z.string().min(1).max(120), eventId: z.string().min(1).max(1200) }).parse(request.params);
    const queryInput = outlookDeleteEventQuery.parse(request.query ?? {});
    const ticket = extractBearerToken(request.headers.authorization);
    const payload = await requireSourceProxyAccess({ fastify, ticket, sourceId: params.sourceId });
    if (!payload.workspaceId) {
      throw new ScopedAccessTicketError();
    }

    return deleteWorkspaceOutlookCalendarEvent({
      workspaceId: payload.workspaceId,
      sourceId: params.sourceId,
      eventId: params.eventId,
      calendarId: queryInput.calendarId ?? null,
      expectedChangeKey: queryInput.expectedChangeKey,
      confirmAttendeeCancellation: queryInput.confirmAttendeeCancellation
    });
  });

  fastify.delete("/api/internal/sources/:sourceId/outlook/events/item", async (request) => {
    const params = z.object({ sourceId: z.string().min(1).max(120) }).parse(request.params);
    const queryInput = outlookDeleteEventByIdQuery.parse(request.query ?? {});
    const ticket = extractBearerToken(request.headers.authorization);
    const payload = await requireSourceProxyAccess({ fastify, ticket, sourceId: params.sourceId });
    if (!payload.workspaceId) {
      throw new ScopedAccessTicketError();
    }

    return deleteWorkspaceOutlookCalendarEvent({
      workspaceId: payload.workspaceId,
      sourceId: params.sourceId,
      eventId: queryInput.eventId,
      calendarId: queryInput.calendarId ?? null,
      expectedChangeKey: queryInput.expectedChangeKey,
      confirmAttendeeCancellation: queryInput.confirmAttendeeCancellation
    });
  });
}

function registerInternalOutlookRoutes(fastify: Parameters<FastifyPluginAsync>[0]): void {
  registerInternalOutlookMessageRoutes(fastify);
  registerInternalOutlookCalendarReadRoutes(fastify);
  registerInternalOutlookCalendarMutationRoutes(fastify);
}

export function registerSourceOutlookRoutes(fastify: Parameters<FastifyPluginAsync>[0]): void {
  registerWorkspaceOutlookRoutes(fastify);
  registerInternalOutlookRoutes(fastify);
}

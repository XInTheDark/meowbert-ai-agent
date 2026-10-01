import Fastify from "fastify";
import jwt from "@fastify/jwt";
import { afterEach, describe, expect, it } from "vitest";
import {
  issueScopedAccessTicket,
  ScopedAccessTicketError,
  verifyScopedAccessTicket
} from "./scoped-access-tickets.js";

describe("scoped access tickets", () => {
  const apps: ReturnType<typeof Fastify>[] = [];

  async function createApp() {
    const app = Fastify();
    await app.register(jwt, {
      secret: "test-secret"
    });
    apps.push(app);
    return app;
  }

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
  });

  it("issues and verifies task event stream tickets", async () => {
    const app = await createApp();
    const issued = await issueScopedAccessTicket(app, {
      scope: "task_events_stream",
      userId: "user-1",
      taskId: "task-1"
    });

    const verified = await verifyScopedAccessTicket(app, {
      ticket: issued.ticket,
      scope: "task_events_stream",
      taskId: "task-1"
    });

    expect(verified.userId).toBe("user-1");
    expect(verified.taskId).toBe("task-1");
    expect(issued.expiresAt).toMatch(/T/);
  });

  it("issues and verifies workspace notification stream tickets", async () => {
    const app = await createApp();
    const issued = await issueScopedAccessTicket(app, {
      scope: "workspace_notifications_stream",
      userId: "user-1",
      workspaceId: "workspace-1"
    });

    const verified = await verifyScopedAccessTicket(app, {
      ticket: issued.ticket,
      scope: "workspace_notifications_stream",
      workspaceId: "workspace-1"
    });

    expect(verified.userId).toBe("user-1");
    expect(verified.workspaceId).toBe("workspace-1");
  });

  it("rejects tickets for the wrong scope or resource", async () => {
    const app = await createApp();
    const issued = await issueScopedAccessTicket(app, {
      scope: "project_canvas_preview",
      userId: "user-1",
      sessionId: "session-1"
    });

    await expect(
      verifyScopedAccessTicket(app, {
        ticket: issued.ticket,
        scope: "task_events_stream",
        taskId: "task-1"
      })
    ).rejects.toBeInstanceOf(ScopedAccessTicketError);

    await expect(
      verifyScopedAccessTicket(app, {
        ticket: issued.ticket,
        scope: "project_canvas_preview",
        sessionId: "session-2"
      })
    ).rejects.toBeInstanceOf(ScopedAccessTicketError);
  });

  it("rejects normal session JWTs as scoped tickets", async () => {
    const app = await createApp();
    const sessionToken = await app.jwt.sign({
      id: "user-1",
      email: "user@example.com"
    });

    await expect(
      verifyScopedAccessTicket(app, {
        ticket: sessionToken,
        scope: "desktop_computer_stream"
      })
    ).rejects.toBeInstanceOf(ScopedAccessTicketError);
  });

  it("keeps preview tickets valid long enough to navigate multi-page artifacts", async () => {
    const app = await createApp();
    const lifetimeSeconds = async (scope: "task_events_stream" | "task_inline_file_view" | "project_canvas_preview") => {
      const issued = await issueScopedAccessTicket(app, { scope, userId: "user-1", taskId: "task-1" });
      const decoded = app.jwt.decode<{ iat: number; exp: number }>(issued.ticket);
      return decoded ? decoded.exp - decoded.iat : 0;
    };

    expect(await lifetimeSeconds("task_events_stream")).toBe(60);
    expect(await lifetimeSeconds("task_inline_file_view")).toBeGreaterThanOrEqual(60 * 60);
    expect(await lifetimeSeconds("project_canvas_preview")).toBeGreaterThanOrEqual(60 * 60);
  });
});

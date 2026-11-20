import Fastify from "fastify";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../lib/db.js", () => ({ query: vi.fn() }));
vi.mock("../../lib/config.js", () => ({ config: { server: { publicUrl: "https://example.test" }, connectors: { email: { enabled: false } } } }));
vi.mock("../../services/workspaces/workspace-access.js", () => ({ assertWorkspaceMember: vi.fn() }));
vi.mock("../../services/connectors/github/app-auth.js", () => ({ getGitHubCentralWebhookUrl: vi.fn() }));
vi.mock("../../services/connectors/shared-connectors.js", () => ({
  listSharedConnectorSettings: vi.fn(async () => ({ telegram: {}, discord: {} })),
  normalizeConnectorConnectionMode: vi.fn(() => "custom")
}));
vi.mock("../../services/connectors/email/workspace-email-connector.js", () => ({ buildWorkspaceEmailAddress: vi.fn() }));
vi.mock("../../services/connectors/email/inbound-settings.js", () => ({ getEmailInboundSettings: vi.fn(async () => ({})) }));

import { query } from "../../lib/db.js";
import { listConnectorsRoute } from "./list.js";

describe("connector list secret redaction", () => {
  beforeEach(() => vi.mocked(query).mockReset());

  it.each(["owner", "member"])("keeps Telegram credentials out of the %s response", async (role) => {
    vi.mocked(query)
      .mockResolvedValueOnce({ rows: [{
        id: "binding-1", type: "telegram", status: "active",
        config_json: { botToken: "private-bot-token", webhookSecret: "private-webhook-secret", mode: "webhook", agentId: "agent-1" }
      }], rowCount: 1 } as never)
      .mockResolvedValueOnce({ rows: [{ role }], rowCount: 1 } as never);
    const app = Fastify();
    app.decorate("authenticate", async (request) => { request.user = { id: "user-1", email: "user@example.com" }; });
    await app.register(listConnectorsRoute);
    const response = await app.inject({ method: "GET", url: "/api/workspaces/11111111-1111-4111-8111-111111111111/connectors" });
    expect(response.statusCode).toBe(200);
    expect(response.body).not.toContain("private-webhook-secret");
    expect(response.body).not.toContain("private-bot-token");
    expect(response.json().items[0].config).toMatchObject({ agentId: "agent-1", botToken: "***", mode: "webhook" });
    expect(response.json().items[0].config).not.toHaveProperty("webhookSecret");
    await app.close();
  });
});

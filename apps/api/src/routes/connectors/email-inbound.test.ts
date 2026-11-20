import Fastify from "fastify";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../lib/config.js", () => ({ config: { connectors: { email: { enabled: true } }, server: { publicUrl: "https://example.test" } } }));
vi.mock("../../lib/db.js", () => ({ query: vi.fn() }));
vi.mock("../../services/connectors/email/workspace-email-connector.js", () => ({
  getWorkspaceEmailConnector: vi.fn(), upsertWorkspaceEmailConnector: vi.fn(), disableWorkspaceEmailConnector: vi.fn(),
  buildWorkspaceEmailAddress: vi.fn(), sanitizeLocalPartFromUserInput: vi.fn(), AUTO_LOCAL_PART_SENTINEL: "auto"
}));
vi.mock("../../services/connectors/connector-tools.js", () => ({ normalizeConnectorToolOptionsConfig: vi.fn() }));
vi.mock("../../services/environments/environment-memory.js", () => ({ isEnvironmentMemoryEnabled: vi.fn() }));
vi.mock("../../services/connectors/email/inbound-settings.js", () => ({ getEmailInboundSettings: vi.fn() }));
vi.mock("../../services/connectors/email/inbound-debug-events.js", () => ({ appendEmailInboundDebugEvent: vi.fn() }));
vi.mock("../../services/connectors/email/brevo-inbound-delivery.js", () => ({ deliverBrevoInboundMessage: vi.fn() }));
vi.mock("../../services/workspaces/workspace-access.js", () => ({ assertWorkspaceMember: vi.fn(), assertWorkspaceOwner: vi.fn() }));

import { getEmailInboundSettings } from "../../services/connectors/email/inbound-settings.js";
import { deliverBrevoInboundMessage } from "../../services/connectors/email/brevo-inbound-delivery.js";
import { emailConnectorRoutes } from "./email.js";

describe("Brevo webhook batch delivery", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(getEmailInboundSettings).mockResolvedValue({
      enabled: true, webhookSecret: "secret", inboundDomain: "inbound.example.com", brevoApiKey: "key", debugLoggingEnabled: false
    } as never);
    vi.mocked(deliverBrevoInboundMessage).mockImplementation(async (inbound) => ({ statusCode: 200, payload: { ok: true, taskId: inbound.messageId } }));
  });

  it("delivers every email in a batch, including messages after invalid entries", async () => {
    const app = Fastify();
    app.decorate("authenticate", async () => {});
    await app.register(emailConnectorRoutes);
    const message = (MessageId: string) => ({ MessageId, From: "sender@example.com", To: ["recipient@inbound.example.com"] });
    const response = await app.inject({ method: "POST", url: "/api/connectors/email/inbound/brevo?token=secret", payload: {
      items: [message("one"), {}, message("two"), message("three")]
    } });
    expect(response.statusCode).toBe(200);
    expect(vi.mocked(deliverBrevoInboundMessage).mock.calls.map(([inbound]) => inbound.messageId)).toEqual(["one", "two", "three"]);
    await app.close();
  });

  it("preserves the single-email response and rejects an invalid webhook token before delivery", async () => {
    const app = Fastify();
    app.decorate("authenticate", async () => {});
    await app.register(emailConnectorRoutes);
    const payload = { MessageId: "single", From: "sender@example.com", To: ["recipient@inbound.example.com"] };
    const denied = await app.inject({ method: "POST", url: "/api/connectors/email/inbound/brevo?token=wrong", payload });
    expect(denied.statusCode).toBe(401);
    expect(deliverBrevoInboundMessage).not.toHaveBeenCalled();
    const accepted = await app.inject({ method: "POST", url: "/api/connectors/email/inbound/brevo?token=secret", payload });
    expect(accepted.statusCode).toBe(200);
    expect(accepted.json()).toEqual({ ok: true, taskId: "single" });
    await app.close();
  });
});

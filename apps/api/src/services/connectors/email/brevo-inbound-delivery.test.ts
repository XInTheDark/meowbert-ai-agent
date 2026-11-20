import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./inbound-ingest.js", () => ({ processInboundEmailForWorkspace: vi.fn() }));
vi.mock("./workspace-email-connector.js", () => ({ findWorkspaceEmailConnectorByRecipient: vi.fn(), shouldAllowEmailSender: vi.fn() }));

import { processInboundEmailForWorkspace } from "./inbound-ingest.js";
import { findWorkspaceEmailConnectorByRecipient, shouldAllowEmailSender } from "./workspace-email-connector.js";
import { parseBrevoInboundMessages } from "./brevo-inbound.js";
import { deliverBrevoInboundMessage } from "./brevo-inbound-delivery.js";
import type { EmailInboundSettings } from "./inbound-settings.js";

const settings = { inboundDomain: "inbound.example.com", brevoApiKey: "key" } as EmailInboundSettings;
const inbound = parseBrevoInboundMessages({ MessageId: "email-1", From: "sender@example.com", To: ["inbox@inbound.example.com"] })[0];

describe("Brevo per-message delivery", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(findWorkspaceEmailConnectorByRecipient).mockResolvedValue({
      workspaceId: "workspace-1", bindingId: "binding-1", senderPolicy: "trusted_only", trustedSenders: ["sender@example.com"]
    } as never);
    vi.mocked(shouldAllowEmailSender).mockReturnValue(true);
  });

  it("preserves recipient routing and successful single-message response", async () => {
    vi.mocked(processInboundEmailForWorkspace).mockResolvedValue({ processed: true, taskId: "task-1", environmentId: "project-1", action: "sent_to_master" });
    const log = vi.fn();
    const result = await deliverBrevoInboundMessage(inbound, settings, log);
    expect(result).toEqual({ statusCode: 200, payload: { ok: true, taskId: "task-1", environmentId: "project-1", action: "sent_to_master" } });
    expect(processInboundEmailForWorkspace).toHaveBeenCalledWith(expect.objectContaining({ inbound, recipientAddress: "inbox@inbound.example.com", brevoApiKey: "key" }));
    expect(log).toHaveBeenCalledWith(expect.objectContaining({ eventType: "message_processed", workspaceId: "workspace-1" }));
  });

  it("blocks untrusted senders before ingest", async () => {
    vi.mocked(shouldAllowEmailSender).mockReturnValue(false);
    expect(await deliverBrevoInboundMessage(inbound, settings, vi.fn())).toEqual({ statusCode: 200, payload: { ok: true } });
    expect(processInboundEmailForWorkspace).not.toHaveBeenCalled();
  });

  it("still acknowledges a duplicate email without inventing a new task", async () => {
    vi.mocked(processInboundEmailForWorkspace).mockResolvedValue({ processed: false, reason: "duplicate_message" });
    expect(await deliverBrevoInboundMessage(inbound, settings, vi.fn())).toEqual({ statusCode: 200, payload: { ok: true } });
  });

  it("keeps transient configuration failure retryable", async () => {
    const result = await deliverBrevoInboundMessage(inbound, { ...settings, brevoApiKey: null }, vi.fn());
    expect(result.statusCode).toBe(503);
    expect(processInboundEmailForWorkspace).not.toHaveBeenCalled();
  });
});

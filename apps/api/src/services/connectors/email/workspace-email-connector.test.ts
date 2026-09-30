import { describe, expect, it } from "vitest";
import {
  buildWorkspaceEmailAddress,
  sanitizeLocalPartFromUserInput,
  shouldAllowEmailSender
} from "./workspace-email-connector.js";

describe("workspace email connector helpers", () => {
  it("builds normalized workspace email addresses", () => {
    expect(buildWorkspaceEmailAddress("Team.Inbox", "Inbound.Example.com")).toBe("team.inbox@inbound.example.com");
    expect(buildWorkspaceEmailAddress("bad local", "inbound.example.com")).toBeNull();
    expect(buildWorkspaceEmailAddress("team", "bad/domain.com")).toBeNull();
  });

  it("sanitizes user-entered local parts", () => {
    expect(sanitizeLocalPartFromUserInput(" Team+Ops ")).toBe("team+ops");
    expect(sanitizeLocalPartFromUserInput("invalid local")).toBeNull();
  });

  it("enforces trusted sender policy", () => {
    expect(
      shouldAllowEmailSender({
        senderPolicy: "allow_any",
        trustedSenders: [],
        senderEmail: "anyone@example.com"
      })
    ).toBe(true);

    expect(
      shouldAllowEmailSender({
        senderPolicy: "trusted_only",
        trustedSenders: ["ops@example.com", "alerts@example.com"],
        senderEmail: "OPS@example.com"
      })
    ).toBe(true);

    expect(
      shouldAllowEmailSender({
        senderPolicy: "trusted_only",
        trustedSenders: ["ops@example.com"],
        senderEmail: "unknown@example.com"
      })
    ).toBe(false);
  });
});

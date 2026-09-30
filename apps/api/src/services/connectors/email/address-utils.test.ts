import { describe, expect, it } from "vitest";
import {
  normalizeEmailAddress,
  normalizeEmailLocalPart,
  normalizeInboundDomain,
  parseTrustedSenderArray,
  parseTrustedSenderList,
  splitNormalizedEmailAddress
} from "./address-utils.js";

describe("email address utils", () => {
  it("normalizes inbound domains", () => {
    expect(normalizeInboundDomain("@Inbound.Example.COM.")).toBe("inbound.example.com");
    expect(normalizeInboundDomain(" inbound.example.com ")).toBe("inbound.example.com");
  });

  it("rejects malformed inbound domains", () => {
    expect(normalizeInboundDomain(null)).toBeNull();
    expect(normalizeInboundDomain("")).toBeNull();
    expect(normalizeInboundDomain("bad/domain.com")).toBeNull();
    expect(normalizeInboundDomain("user@example.com")).toBeNull();
  });

  it("normalizes email addresses", () => {
    expect(normalizeEmailAddress("Alice Example <Alice@Example.COM>")).toBe("alice@example.com");
    expect(normalizeEmailAddress("team+bot@Inbound.Example.com")).toBe("team+bot@inbound.example.com");
    expect(normalizeEmailAddress("not-an-address")).toBeNull();
  });

  it("normalizes local parts", () => {
    expect(normalizeEmailLocalPart("Team.Inbox+Ops")).toBe("team.inbox+ops");
    expect(normalizeEmailLocalPart("team inbox")).toBeNull();
    expect(normalizeEmailLocalPart(".starts-with-dot")).toBeNull();
    expect(normalizeEmailLocalPart("team@example.com")).toBe("team");
  });

  it("parses and deduplicates trusted senders", () => {
    expect(
      parseTrustedSenderList("Alice@example.com, invalid , ALICE@example.com, Bob@example.com")
    ).toEqual(["alice@example.com", "bob@example.com"]);

    expect(
      parseTrustedSenderArray(["Alice@example.com", "alice@example.com", "not-an-email"])
    ).toEqual(["alice@example.com"]);
  });

  it("splits normalized addresses into local/domain parts", () => {
    expect(splitNormalizedEmailAddress("Ops.Bot@Inbound.Example.com")).toEqual({
      localPart: "ops.bot",
      domain: "inbound.example.com"
    });
    expect(splitNormalizedEmailAddress("not-an-email")).toBeNull();
  });
});

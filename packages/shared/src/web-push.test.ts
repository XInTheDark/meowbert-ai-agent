import { describe, expect, it } from "vitest";
import { isAllowedWebPushEndpoint } from "./web-push.js";

describe("isAllowedWebPushEndpoint", () => {
  it("allows supported browser push provider endpoints", () => {
    expect(isAllowedWebPushEndpoint("https://fcm.googleapis.com/wp/123")).toBe(true);
    expect(isAllowedWebPushEndpoint("https://updates.push.services.mozilla.com/wpush/v2/123")).toBe(true);
    expect(isAllowedWebPushEndpoint("https://web.push.apple.com/123")).toBe(true);
    expect(isAllowedWebPushEndpoint("https://wns2.example.notify.windows.com/w/?token=123")).toBe(true);
  });

  it("rejects non-provider and non-HTTPS endpoints", () => {
    expect(isAllowedWebPushEndpoint("https://push.example.com/sub/123")).toBe(false);
    expect(isAllowedWebPushEndpoint("http://fcm.googleapis.com/wp/123")).toBe(false);
    expect(isAllowedWebPushEndpoint("https://127.0.0.1:8443/metadata")).toBe(false);
    expect(isAllowedWebPushEndpoint("https://fcm.googleapis.com.evil.example/wp/123")).toBe(false);
    expect(isAllowedWebPushEndpoint("https://user:password@fcm.googleapis.com/wp/123")).toBe(false);
  });
});

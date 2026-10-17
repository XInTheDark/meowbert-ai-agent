import type { FastifyReply } from "fastify";
import { CANVAS_FRAME_SANDBOX } from "@meowbert/shared/canvas-frame-runtime";

// Agent-written pages (canvases, inline artifacts) are served from the API origin. The app shows
// them in sandboxed iframes; this policy applies the same sandbox when one is opened directly in
// a tab, so the page runs in an opaque origin rather than as the API.
// It matches the flags the app's canvas iframes use, so a page behaves the same in both places.
const SANDBOX_POLICY = `sandbox ${CANVAS_FRAME_SANDBOX}`;

export function applyUntrustedContentHeaders(reply: FastifyReply): void {
  const existingPolicy = reply.getHeader("content-security-policy");
  // Keep a policy the content already set (for example a proxied dev server); both are enforced.
  reply.header(
    "Content-Security-Policy",
    typeof existingPolicy === "string" && existingPolicy.trim().length > 0
      ? `${existingPolicy}, ${SANDBOX_POLICY}`
      : SANDBOX_POLICY
  );
  reply.header("X-Content-Type-Options", "nosniff");
  reply.header("Referrer-Policy", "no-referrer");
}

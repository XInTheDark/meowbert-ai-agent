import { expect, it, vi } from "vitest";
vi.mock("../../lib/config.js", () => ({config:{}}));
vi.mock("../../lib/db.js", () => ({query:vi.fn(),pool:{}}));
vi.mock("../../lib/queue.js", () => ({taskQueue:{}}));
vi.mock("../runtime/debug-task-events.js", () => ({}));
import { resolveLocalDevicePendingReason } from "./task-run-dispatch.js";
const device = () => ({ id:"d",maxConcurrentRuns:2,activeRuns:0,lastSeenAt:new Date().toISOString(),streamExpiresAt:new Date(Date.now()+20_000).toISOString(),requiredImageDigest:"sha256:new",revokedAt:null,verifiedRoots:{backend:"/runtime"},capabilities:{dockerReady:true,sandboxImageReady:true,executorSupported:true,protocolVersion:1,sandboxImageDigest:"sha256:new"} });
it.each([
  ["wrong backend", (d: ReturnType<typeof device>) => { d.verifiedRoots = {} as never; }, "storage_unavailable"],
  ["closed stream", (d: ReturnType<typeof device>) => { d.streamExpiresAt = "invalid"; }, "device_offline"],
  ["old digest", (d: ReturnType<typeof device>) => { d.capabilities.sandboxImageDigest = "sha256:old"; }, "sandbox_updating"],
  ["update downloading", (d: ReturnType<typeof device>) => { Object.assign(d.capabilities, { sandboxImageReady: false, sandboxDownloadInProgress: true }); }, "sandbox_updating"],
  ["first download", (d: ReturnType<typeof device>) => { Object.assign(d.capabilities, { sandboxImageReady: false, sandboxDownloadInProgress: true, sandboxImageDigest: null }); }, "sandbox_downloading"],
  ["protocol mismatch", (d: ReturnType<typeof device>) => { d.capabilities.protocolVersion = 2; }, "executor_outdated"],
  ["Docker stopped", (d: ReturnType<typeof device>) => { d.capabilities.dockerReady = false; }, "docker_unavailable"]
] as const)("keeps a device pending for %s", (_label, change, reason) => {
  const d = device(); change(d);
  expect(resolveLocalDevicePendingReason({device:d,storageBackendId:"backend",localExecutionEnabled:true})).toBe(reason);
});
it("admits a device only when all readiness checks pass", () => {
  expect(resolveLocalDevicePendingReason({device:device(),storageBackendId:"backend",localExecutionEnabled:true})).toBeNull();
});

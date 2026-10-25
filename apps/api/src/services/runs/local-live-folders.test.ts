import Fastify from "fastify";
import { beforeEach, expect, it, vi } from "vitest";
import { signRunLeaseToken, type RunLeaseClaims } from "@meowbert/shared/run-lease-token";
vi.mock("../../lib/db.js", () => ({ query: vi.fn() }));
vi.mock("../../lib/config.js", () => ({ config: { localExecution: { enabled: true }, security: { jwtSecret: "secret" } } }));
vi.mock("../sources/workspace-source-connections.js", () => ({ getWorkspaceSourceConnection: vi.fn() }));
vi.mock("../sources/source-access.js", () => ({ resolveWorkspaceSourceAccess: vi.fn() }));
import { query } from "../../lib/db.js";
import { getWorkspaceSourceConnection } from "../sources/workspace-source-connections.js";
import { resolveWorkspaceSourceAccess } from "../sources/source-access.js";
import { listLocalLiveFolders, localLiveFolderConfig } from "./local-live-folders.js";
import { runLiveFolderRoutes } from "../../routes/runs/live-folders.js";
const runId = "11111111-1111-4111-8111-111111111111";
const linkId = "22222222-2222-4222-8222-222222222222";
const deviceId = "33333333-3333-4333-8333-333333333333";
const claims = { runId, taskId: "task", holder: "device:" + deviceId, epoch: 4 } as RunLeaseClaims;
const connection = { workspaceId: "workspace", provider: "google-drive", accountId: "account", accountLabel: "owner@example.test",
  connectedAt: "2026-10-25", updatedByUserId: "owner", tokens: { accessToken: "access-secret", refreshToken: "refresh-secret", tokenType: "Bearer", expiresAt: null } };
let live: boolean;
beforeEach(() => {
  vi.clearAllMocks(); live = true;
  vi.mocked(query).mockImplementation(async (sql: string) => ({ rows: sql.includes("SELECT dv.user_id") ? (live ? [{ user_id: "owner" }] : [])
    : [{ id: linkId, workspace_id: "workspace", local_relative_path: "context/docs", remote_item_id: "drive-folder" }] }) as never);
  vi.mocked(getWorkspaceSourceConnection).mockResolvedValue(connection as never);
  vi.mocked(resolveWorkspaceSourceAccess).mockResolvedValue({ connection, settings: { clientId: "client", clientSecret: "client-secret" } } as never);
});
it("lists no credentials and only returns config after consent to the same connection", async () => {
  const [metadata] = await listLocalLiveFolders(claims);
  expect(JSON.stringify(metadata)).not.toContain("secret");
  expect(resolveWorkspaceSourceAccess).not.toHaveBeenCalled();
  const config = await localLiveFolderConfig(claims, linkId, metadata.connectionId);
  expect(config.config).toContain("root_folder_id = drive-folder");
  expect(config.config).toContain('"refresh_token":"refresh-secret"');
  await expect(localLiveFolderConfig(claims, "another-link", metadata.connectionId)).rejects.toMatchObject({ statusCode: 404 });
});
it("denies another user's connection and consent from before reconnection", async () => {
  const [metadata] = await listLocalLiveFolders(claims);
  vi.mocked(getWorkspaceSourceConnection).mockResolvedValue({ ...connection, updatedByUserId: "another-user" } as never);
  await expect(listLocalLiveFolders(claims)).rejects.toMatchObject({ statusCode: 403 });
  vi.mocked(getWorkspaceSourceConnection).mockResolvedValue({ ...connection, connectedAt: "2026-10-26" } as never);
  await expect(localLiveFolderConfig(claims, linkId, metadata.connectionId)).rejects.toThrow("Consent is required again");
  expect(resolveWorkspaceSourceAccess).not.toHaveBeenCalled();
});
it("rechecks the lease after token refresh and never returns credentials to a revoked device", async () => {
  const [metadata] = await listLocalLiveFolders(claims);
  vi.mocked(resolveWorkspaceSourceAccess).mockImplementationOnce(async () => { live = false; return { connection, settings: { clientId: "client", clientSecret: "secret" } } as never; });
  await expect(localLiveFolderConfig(claims, linkId, metadata.connectionId)).rejects.toMatchObject({ code: "lease_lost" });
});
it("requires a signed matching lease and explicit consent at the HTTP boundary", async () => {
  const app = Fastify(); await app.register(runLiveFolderRoutes);
  try {
    const token = signRunLeaseToken(claims, "secret");
    const route = "/api/runs/" + runId + "/live-folders";
    expect((await app.inject(route)).statusCode).toBe(401);
    const metadata = await app.inject({ url: route, headers: { authorization: "Bearer " + token } });
    expect(metadata.statusCode).toBe(200); expect(metadata.headers["cache-control"]).toBe("no-store");
    const connectionId = metadata.json().folders[0].connectionId;
    expect((await app.inject({ method: "POST", url: route + "/" + linkId + "/rclone-config", headers: { authorization: "Bearer " + token }, payload: { connectionId } })).statusCode).toBe(400);
    const result = await app.inject({ method: "POST", url: route + "/" + linkId + "/rclone-config", headers: { authorization: "Bearer " + token }, payload: { connectionId, consent: true } });
    expect(result.statusCode).toBe(200); expect(result.headers["cache-control"]).toBe("no-store");
  } finally { await app.close(); }
});

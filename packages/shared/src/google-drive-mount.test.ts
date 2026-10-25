import { expect, it } from "vitest";
import { buildGoogleDriveMountConfig, googleDriveMountArgs } from "./google-drive-mount.js";
const input = { clientId: "client", clientSecret: "secret", rootFolderId: "folder", tokens: { accessToken: "access", refreshToken: "refresh", tokenType: null, expiresAt: null } };
it("uses the same Drive view for server FUSE and desktop NFS without allow-other on desktop", () => {
  const common = { configPath: "/config", mountPoint: "/folder" };
  const cloud = googleDriveMountArgs({ ...common, transport: "fuse" });
  const desktop = googleDriveMountArgs({ ...common, transport: "nfs" });
  expect(cloud[2]).toBe("mount"); expect(desktop[2]).toBe("nfsmount");
  expect(desktop).not.toContain("--allow-other");
  expect(desktop.filter((flag) => flag !== "nfsmount")).toEqual(cloud.filter((flag) => flag !== "mount" && flag !== "--allow-other"));
  expect(buildGoogleDriveMountConfig(input)).toContain('"refresh_token":"refresh"');
});
it("refuses config-section injection and quotes token values as JSON", () => {
  expect(() => buildGoogleDriveMountConfig({ ...input, rootFolderId: "id\n[other]" })).toThrow("Invalid");
  const config = buildGoogleDriveMountConfig({ ...input, tokens: { ...input.tokens, accessToken: 'value\n"quoted"' } });
  const token = config.split("\n").find((line) => line.startsWith("token = "))!.slice(8);
  expect(JSON.parse(token).access_token).toBe('value\n"quoted"');
});

import { expect, it, vi } from "vitest";
import { ensureSandboxImage, imageHasDigest, imageRepository } from "./manager";
it("keeps registry ports when pinning images and inspects actual repository digests", () => {
  expect(imageRepository("localhost:5000/meowbert:main")).toBe("localhost:5000/meowbert");
  expect(imageHasDigest("localhost:5000/meowbert@sha256:abc", "sha256:abc", [])).toBe(false);
  expect(imageHasDigest("localhost:5000/meowbert:main", "sha256:abc", ["localhost:5000/meowbert@sha256:abc"])).toBe(true);
});
it("pulls a changed server digest and refuses mismatched downloaded content", async () => {
  const client = { inspect: vi.fn().mockResolvedValue({ repoDigests: ["registry/image@sha256:old"] }), pull: vi.fn() };
  await expect(ensureSandboxImage({ client, image: { reference: "registry/image:main", digest: "sha256:new" } })).rejects.toThrow(/does not match/);
  expect(client.pull).toHaveBeenCalledWith("registry/image@sha256:new", undefined);
});
it("never tries to pull an uninstalled local-only image", async () => {
  const client = { inspect: vi.fn().mockRejectedValue(new Error("not found")), pull: vi.fn() };
  await expect(ensureSandboxImage({ client, image: { reference: "meowbert-sandbox-runtime:local", digest: null } })).rejects.toThrow(/Load/);
  expect(client.pull).not.toHaveBeenCalled();
});
it("reuses the exact installed digest without a download", async () => {
  const client = { inspect: vi.fn().mockResolvedValue({ repoDigests: ["registry/image@sha256:new"] }), pull: vi.fn() };
  await expect(ensureSandboxImage({ client, image: { reference: "registry/image:main", digest: "sha256:new" } })).resolves.toMatchObject({ downloaded: false });
  expect(client.pull).not.toHaveBeenCalled();
});

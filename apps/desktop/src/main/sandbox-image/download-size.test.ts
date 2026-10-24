import { expect, it, vi } from "vitest";
import { sandboxDownloadSize } from "./download-size";
it("reports compressed arm64 layer sizes from the pinned multiarch manifest", async () => {
  const request = vi.fn().mockResolvedValueOnce(Response.json({ manifests: [
    { digest: "sha256:amd", platform: { os: "linux", architecture: "amd64" } },
    { digest: "sha256:arm", platform: { os: "linux", architecture: "arm64" } }
  ] })).mockResolvedValueOnce(Response.json({ layers: [{ size: 100 }, { size: 200 }], config: { size: 5 } }));
  expect(await sandboxDownloadSize({ reference: "ghcr.io/owner/image:main", digest: "sha256:index" }, request)).toBe(305);
  expect(request.mock.calls[1][0]).toBe("https://ghcr.io/v2/owner/image/manifests/sha256%3Aarm");
});
it("handles anonymous registry bearer auth without downloading layers", async () => {
  const request = vi.fn().mockResolvedValueOnce(new Response(null, { status: 401, headers: {
    "www-authenticate": 'Bearer realm="https://ghcr.io/token",service="ghcr.io",scope="repository:owner/image:pull"'
  } })).mockResolvedValueOnce(Response.json({ token: "registry-token" }))
    .mockResolvedValueOnce(Response.json({ layers: [{ size: 42 }] }));
  expect(await sandboxDownloadSize({ reference: "ghcr.io/owner/image", digest: "sha256:index" }, request)).toBe(42);
  expect(request.mock.calls[2][1].headers.authorization).toBe("Bearer registry-token");
  expect(request).toHaveBeenCalledTimes(3);
});
it("leaves size unknown for local images or unavailable registry metadata", async () => {
  const request = vi.fn().mockRejectedValue(new Error("offline"));
  expect(await sandboxDownloadSize({ reference: "image:local", digest: null }, request)).toBeNull();
  expect(request).not.toHaveBeenCalled();
  expect(await sandboxDownloadSize({ reference: "ghcr.io/owner/image", digest: "sha256:index" }, request)).toBeNull();
});

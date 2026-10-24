import Fastify from "fastify";
import { expect, it, vi } from "vitest";
const query = vi.hoisted(() => vi.fn());
vi.mock("../lib/db.js", () => ({ query, withTransaction: vi.fn() }));
vi.mock("../lib/config.js", () => ({ config: {
  localExecution: { enabled: true }, runApi: { url: "http://worker" }, storage: { backends: [] },
  runtime: { sandbox: { image: "api-default-image:main" }, shell: "/bin/bash" }, skills: {}
} }));
vi.mock("../services/workspaces/workspace-access.js", () => ({ assertEnvironmentMember: vi.fn() }));
import { deviceRoutes } from "./devices.js";
it("returns the worker's recorded repository and digest for desktop pulls", async () => {
  query.mockResolvedValue({ rows: [{ sandbox_image_reference: "registry.example/worker-image:main", sandbox_image_digest: "sha256:worker" }] });
  const app = Fastify(); app.decorate("authenticate", async () => {});
  await app.register(deviceRoutes);
  try {
    const response = await app.inject({ method: "GET", url: "/api/local-execution/config" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ enabled: true, sandboxImage: { reference: "registry.example/worker-image:main", digest: "sha256:worker" } });
  } finally { await app.close(); }
});

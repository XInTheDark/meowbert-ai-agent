import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";

vi.mock("./core-routes.js", () => ({ registerEnvironmentCoreRoutes: vi.fn() }));
vi.mock("./canvas-routes.js", () => ({ registerEnvironmentCanvasRoutes: vi.fn() }));
vi.mock("./file-routes.js", () => ({ registerEnvironmentFileRoutes: vi.fn() }));
vi.mock("./task-folder-routes.js", () => ({ registerEnvironmentTaskFolderRoutes: vi.fn() }));
vi.mock("./task-routes.js", () => ({ registerEnvironmentTaskRoutes: vi.fn() }));
vi.mock("./persistent-shell-routes.js", () => ({ registerEnvironmentPersistentShellRoutes: vi.fn() }));

import { projectRoutes } from "../environments.js";

describe("retired human terminal endpoints", () => {
  it("does not expose manual execution, history or sessions through either project route alias", async () => {
    const app = Fastify();
    await app.register(projectRoutes);
    try {
      for (const prefix of ["projects", "environments"]) {
        const base = `/api/${prefix}/11111111-1111-4111-8111-111111111111/shell`;
        for (const [method, suffix] of [["POST", "execute"], ["GET", "history"], ["POST", "sessions"], ["GET", "sessions"]] as const) {
          const response = await app.inject({ method, url: `${base}/${suffix}` });
          expect(response.statusCode).toBe(404);
        }
      }
    } finally {
      await app.close();
    }
  });
});

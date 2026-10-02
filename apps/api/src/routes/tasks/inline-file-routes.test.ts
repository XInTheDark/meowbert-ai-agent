import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../services/auth/scoped-access-tickets.js", () => ({
  issueScopedAccessTicket: vi.fn(async () => ({ ticket: "ticket-1" })),
  verifyScopedAccessTicket: vi.fn(async () => ({ userId: "user-1" }))
}));

vi.mock("../../services/tasks/task-inline-files.js", () => ({
  resolveTaskInlineFile: vi.fn(),
  resolvePublicTaskInlineFile: vi.fn()
}));

vi.mock("../../services/workspaces/workspace-access.js", () => ({
  assertTaskMember: vi.fn(async () => {})
}));

import { resolveTaskInlineFile } from "../../services/tasks/task-inline-files.js";
import { registerTaskInlineFileRoutes } from "./inline-file-routes.js";

const tempDirs: string[] = [];

async function createTempDir(prefix: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("registerTaskInlineFileRoutes", () => {
  const mockedResolveTaskInlineFile = vi.mocked(resolveTaskInlineFile);

  beforeEach(() => {
    mockedResolveTaskInlineFile.mockReset();
  });

  it("serves authenticated inline files even when the ticket segment is longer than Fastify's default param limit", async () => {
    const app = Fastify();
    app.decorate("authenticate", async () => {});

    const tempDir = await createTempDir("meowbert-inline-route-");
    const filePath = path.join(tempDir, "inline-preview-third-retry.html");
    await fs.writeFile(filePath, "<!doctype html><html><body>inline ok</body></html>");

    mockedResolveTaskInlineFile.mockResolvedValueOnce({
      absolutePath: filePath,
      relativePath: "html-canvas-test/inline-preview-third-retry.html",
      sizeBytes: (await fs.stat(filePath)).size
    });

    await registerTaskInlineFileRoutes(app);

    const longTicket = "a".repeat(220);
    const response = await app.inject({
      method: "GET",
      url: `/api/tasks/326522d1-67cc-4475-92ce-a85b18556261/inline-files/${longTicket}/html-canvas-test/inline-preview-third-retry.html`
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/html");
    expect(response.headers["content-security-policy"]).toMatch(/^sandbox /);
    expect(response.headers["content-security-policy"]).not.toContain("allow-same-origin");
    expect(response.body).toContain("inline ok");
    expect(mockedResolveTaskInlineFile).toHaveBeenCalledWith(
      "326522d1-67cc-4475-92ce-a85b18556261",
      "html-canvas-test/inline-preview-third-retry.html"
    );

    await app.close();
  });
});

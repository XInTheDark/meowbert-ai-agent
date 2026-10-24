import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ create: vi.fn(), remove: vi.fn() }));
vi.mock("./manager", () => ({ createDesktopDocker: () => ({ getImage: () => ({ inspect: async () => ({ Id: "sha256:image" }) }), createContainer: state.create }) }));
import { prepareWindowsSkillCatalog } from "./windows-catalog";

it("caches image-owned manifests and docs without copying Linux binaries onto NTFS", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "meowbert-catalog-"));
  state.create.mockResolvedValue({ start: async () => {}, wait: async () => ({ StatusCode: 0 }), remove: state.remove,
    logs: async () => Buffer.from(JSON.stringify([{ name: "documents", manifest: '{"id":"documents"}', doc: "Read documents" }])) });
  try {
    const catalog = await prepareWindowsSkillCatalog("image@digest", root, "device");
    expect(await fs.readFile(path.join(catalog, "documents/skill.md"), "utf8")).toBe("Read documents");
    expect(await fs.readdir(path.join(catalog, "documents"))).toEqual(["skill.json", "skill.md"]);
    expect(await prepareWindowsSkillCatalog("image@digest", root, "device")).toBe(catalog);
    expect(state.create).toHaveBeenCalledTimes(1);
    expect(state.remove).toHaveBeenCalledWith({ force: true });
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

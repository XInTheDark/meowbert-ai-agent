import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const output = path.join(root, "apps/desktop/dist/host-skills");
await fs.rm(output, { recursive: true, force: true });
for (const name of await fs.readdir(path.join(root, "skills"))) {
  const dir = path.join(root, "skills", name);
  const manifest = await fs.readFile(path.join(dir, "skill.json"), "utf8").then(JSON.parse).catch(() => null);
  if (manifest?.host !== "supported") continue;
  const target = path.join(output, name);
  await fs.mkdir(target, { recursive: true });
  await fs.copyFile(path.join(dir, "skill.json"), path.join(target, "skill.json"));
  await fs.copyFile(path.join(dir, "skill.md"), path.join(target, "skill.md"));
  const entry = path.join(dir, manifest.mcp.args[0]);
  await build({ entryPoints: [entry], outfile: path.join(target, "server.mjs"), bundle: true, platform: "node", format: "esm",
    banner: { js: 'import { createRequire as __hostCreateRequire } from "node:module"; const require = __hostCreateRequire(import.meta.url);' } });
  manifest.mcp = { ...manifest.mcp, command: "node", args: ["server.mjs"], cwd: "{{SKILL_DIR}}" };
  await fs.writeFile(path.join(target, "skill.json"), JSON.stringify(manifest, null, 2) + "\n");
}

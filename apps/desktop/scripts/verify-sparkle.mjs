import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { _electron } from "playwright";

const userData = await mkdtemp(path.join(os.tmpdir(), "meowbert-sparkle-smoke-"));
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
delete env.ELECTRON_RENDERER_URL;
delete env.SPARKLE_ED_PRIVATE_KEY;
let application;
let output = "";
try {
  application = await _electron.launch({
    executablePath: path.resolve(process.argv[2]),
    args: ["--remote-debugging-port=0", `--user-data-dir=${userData}`], env, timeout: 30_000
  });
  const child = application.process();
  child.stdout?.on("data", (chunk) => { output += chunk.toString(); });
  child.stderr?.on("data", (chunk) => { output += chunk.toString(); });
  const state = await application.evaluate(async ({ app }) => {
    await app.whenReady();
    const require = process.getBuiltinModule("module").createRequire(`${app.getAppPath()}/package.json`);
    const native = require(`${process.resourcesPath}/../Frameworks/electron_sparkle.node`);
    const deadline = Date.now() + 15_000;
    let current = native.getState();
    while ((!current.started || !current.canCheckForUpdates) && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      current = native.getState();
    }
    return current;
  });
  const detail = `Unexpected Sparkle state: ${JSON.stringify(state)}`;
  assert.equal(state.started, true, detail);
  assert.equal(state.canCheckForUpdates, true, detail);
  assert.equal(state.automaticallyChecksForUpdates, true, detail);
  assert.equal(state.automaticallyDownloadsUpdates, true, detail);
  console.log("Verified packaged Sparkle startup and automatic update settings.");
} catch (error) {
  if (output.trim()) console.error(output.trim());
  throw error;
} finally {
  await application?.close();
  await rm(userData, { recursive: true, force: true });
}

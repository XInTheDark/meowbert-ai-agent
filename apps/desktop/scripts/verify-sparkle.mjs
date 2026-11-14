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
try {
  application = await _electron.launch({
    executablePath: path.resolve(process.argv[2]),
    args: ["--remote-debugging-port=0", `--user-data-dir=${userData}`], env, timeout: 30_000
  });
  const state = await application.evaluate(async ({ app }) => {
    await app.whenReady();
    const require = process.getBuiltinModule("module").createRequire(`${app.getAppPath()}/package.json`);
    const native = require(`${process.resourcesPath}/../Frameworks/electron_sparkle.node`);
    return native.getState();
  });
  assert.equal(state.canCheckForUpdates, true);
  assert.equal(state.automaticallyChecksForUpdates, true);
  assert.equal(state.automaticallyDownloadsUpdates, true);
  console.log("Verified packaged Sparkle startup and automatic update settings.");
} finally {
  await application?.close();
  await rm(userData, { recursive: true, force: true });
}

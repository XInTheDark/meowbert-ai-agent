const fs = require("node:fs");
const path = require("node:path");
const { createRequire } = require("node:module");
const { pathToFileURL } = require("node:url");

async function main() {
  const resources = path.resolve(process.argv[2]);
  const archive = path.join(resources, "app.asar");
  const appRequire = createRequire(path.join(archive, "package.json"));
  const expectedVersion = require("../package.json").version;
  if (appRequire("./package.json").version !== expectedVersion) throw new Error("Incorrect packaged version.");
  const shared = await import(pathToFileURL(appRequire.resolve("@meowbert/shared")).href);
  await import(pathToFileURL(appRequire.resolve("@meowbert/run-executor/agent/index")).href);
  appRequire("ssh2");
  if (fs.existsSync(path.join(archive, "node_modules/ssh2/lib/protocol/crypto/build/Release/sshcrypto.node"))) {
    throw new Error("The build-host SSH native addon must not be packaged.");
  }
  if (!shared.loadPersonalityBasePrompt() || !shared.loadPersonalityPromptCatalog().entries.length) {
    throw new Error("Packaged personality prompts are missing.");
  }
  const update = fs.readFileSync(path.join(resources, "app-update.yml"), "utf8");
  const publisher = require("../electron-builder.config.cjs").publish[0];
  for (const key of ["owner", "repo", "tagNamePrefix"]) {
    if (!update.split(/\r?\n/).includes(`${key}: ${publisher[key]}`)) throw new Error(`Incorrect updater ${key}.`);
  }
  console.log(`Verified packaged desktop ${expectedVersion}: executor, SSH, prompts, and updater.`);
}

main().catch((error) => { console.error(error); process.exitCode = 1; });

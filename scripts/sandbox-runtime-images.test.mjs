import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { sandboxRuntimeImages } from "./sandbox-runtime-images.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const published = sandboxRuntimeImages("XInTheDark/meowbert-ai-agent");
const defaultImage = published.name + ":main";

function compose(files, override) {
  const env = { ...process.env };
  delete env.MEOWBERT_SANDBOX_RUNTIME_IMAGE;
  if (override) env.MEOWBERT_SANDBOX_RUNTIME_IMAGE = override;
  return JSON.parse(execFileSync("docker", ["compose", ...files.flatMap((file) => ["-f", file]), "config", "--format", "json"], {
    cwd: root, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"]
  }));
}

function checkConsumers(config, image) {
  for (const service of ["api", "worker"]) {
    assert.equal(config.services[service].environment.MEOWBERT_SANDBOX_RUNTIME_IMAGE, image, service + " image differs from publication");
  }
  assert.equal(config.services["sandbox-runtime"].image, image);
}

test("publishes the original name and repository alias for upstream and forks", () => {
  assert.deepEqual(published, { name: "ghcr.io/xinthedark/meowbert-sandbox-runtime",
    aliasName: "ghcr.io/xinthedark/meowbert-ai-agent/sandbox-runtime", platforms: ["linux/amd64", "linux/arm64"] });
  assert.equal(sandboxRuntimeImages("OtherOwner/custom-fork").name, "ghcr.io/otherowner/meowbert-sandbox-runtime");
  assert.equal(sandboxRuntimeImages("OtherOwner/custom-fork").aliasName, "ghcr.io/otherowner/custom-fork/sandbox-runtime");
  assert.throws(() => sandboxRuntimeImages("invalid"));
});

test("example configurations use the image published by Actions", () => {
  for (const name of ["config/global.example.json", "config/global.docker.example.json"]) {
    assert.equal(JSON.parse(readFileSync(path.join(root, name), "utf8")).runtime.sandbox.image, defaultImage, name);
  }
  const example = readFileSync(path.join(root, ".env.example"), "utf8");
  assert.equal(example.match(/^#?\s*MEOWBERT_SANDBOX_RUNTIME_IMAGE=(.+)$/m)?.[1], defaultImage);
});

for (const file of ["docker-compose.yml", "docker-compose.full.yml", "docker-compose.coolify.yml"]) {
  test(file + " pulls the published default and honors custom images everywhere", () => {
    const defaults = compose([file]);
    checkConsumers(defaults, defaultImage);
    assert.equal(defaults.services["sandbox-runtime"].pull_policy, "always");
    assert.equal(defaults.services["sandbox-runtime"].build, undefined);
    assert.equal(defaults.services.worker.depends_on["sandbox-runtime"].restart, true);
    const custom = "registry.example/custom-runtime@sha256:" + "a".repeat(64);
    checkConsumers(compose([file], custom), custom);
  });
}

test("the explicit development override builds and uses only the local image", () => {
  const config = compose(["docker-compose.yml", "docker-compose.local-sandbox.yml"]);
  checkConsumers(config, "meowbert-sandbox-runtime:local");
  assert.equal(config.services["sandbox-runtime"].pull_policy, "never");
  assert.equal(config.services["sandbox-runtime"].build.dockerfile, "apps/sandbox-runtime/Dockerfile");
});

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { test } from "node:test";

const require = createRequire(import.meta.url);
const { version } = require("../package.json");

function publisherTag(releaseTag) {
  const env = { ...process.env };
  delete env.RELEASE_TAG;
  if (releaseTag) env.RELEASE_TAG = releaseTag;
  return execFileSync(process.execPath, ["-e", `
    const config = require(${JSON.stringify(require.resolve("../electron-builder.config.cjs"))});
    const { GitHubPublisher } = require("electron-publish/out/gitHubPublisher.js");
    const publisher = new GitHubPublisher({}, { ...config.publish[0], token: "__test__" }, ${JSON.stringify(version)});
    process.stdout.write(publisher.tag);
  `], { env, encoding: "utf8" });
}

for (const releaseTag of [`desktop-${version}`, `desktop-v${version}`]) {
  test(`uploads archives to the appcast's release tag ${releaseTag}`, () => {
    assert.equal(publisherTag(releaseTag), releaseTag);
  });
}

test("keeps the desktop-v tag for releases outside the workflow", () => {
  assert.equal(publisherTag(), `desktop-v${version}`);
});

import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const root = new URL("../../../", import.meta.url);
const assetNames = [
  "Meowbert-desktop-mac-universal.dmg", "Meowbert-desktop-mac-universal.zip",
  "Meowbert-desktop-win-x64.exe", "Meowbert-desktop-win-x64.zip",
  "latest.yml", "latest-mac.yml", "appcast.xml"
];

async function git(fixture, ...args) {
  return (await execFileAsync("git", args, { cwd: fixture.repository })).stdout.trim();
}

async function fixture(context) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "meowbert-publisher-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const f = { directory, repository: path.join(directory, "repo"), remote: path.join(directory, "origin.git") };
  const bin = path.join(directory, "bin");
  for (const name of ["scripts", "apps/desktop", "config"]) await mkdir(path.join(f.repository, name), { recursive: true });
  await mkdir(bin);
  for (const name of ["scripts/publish_release.sh", "scripts/desktop-version.mjs", "config/desktop-release.cjs"]) {
    await copyFile(new URL(name, root), path.join(f.repository, name));
  }
  await writeFile(path.join(f.repository, "apps/desktop/package.json"), '{"version":"2026.11.4"}\n');
  await writeFile(path.join(f.repository, "package-lock.json"), '{"packages":{"apps/desktop":{"version":"2026.11.4"}}}\n');
  await writeFile(path.join(f.repository, "config/desktop-release.json"), '{"repository":"test/releases"}\n');
  await execFileAsync("git", ["init", "--bare", f.remote]);
  await execFileAsync("git", ["init", "-b", "main", f.repository]);
  for (const [key, value] of [["user.name", "Publisher Test"], ["user.email", "publisher@example.test"], ["commit.gpgsign", "false"], ["tag.gpgSign", "false"]]) {
    await git(f, "config", key, value);
  }
  await git(f, "add", ".");
  await git(f, "commit", "-m", "initial");
  await git(f, "remote", "add", "origin", f.remote);
  await git(f, "push", "-u", "origin", "main");
  f.initialSha = await git(f, "rev-parse", "HEAD");
  f.audit = path.join(directory, "calls.jsonl");
  f.env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, PUBLISH_TEST_AUDIT: f.audit };
  await writeFile(path.join(bin, "gh"), ghStub, { mode: 0o755 });
  await writeFile(path.join(bin, "curl"), curlStub, { mode: 0o755 });
  await writeFile(path.join(bin, "sleep"), "#!/bin/bash\nexit 0\n", { mode: 0o755 });
  return f;
}

const ghStub = `#!/usr/bin/env node
const fs = require("node:fs");
const args = process.argv.slice(2);
fs.appendFileSync(process.env.PUBLISH_TEST_AUDIT, JSON.stringify(["gh", ...args]) + "\\n");
const command = args.slice(0, 2).join(" ");
if (command === "auth status") process.exit(process.env.PUBLISH_TEST_AUTH_FAIL ? 1 : 0);
else if (command === "repo view") console.log("test/source");
else if (command === "run list") console.log("123");
else if (command === "run watch") process.exit(process.env.PUBLISH_TEST_WORKFLOW_FAIL ? 1 : 0);
else if (command === "release view") {
  let names = ${JSON.stringify(assetNames)};
  if (process.env.PUBLISH_TEST_MISSING_ASSET) names = names.filter(name => name !== "appcast.xml");
  console.log(JSON.stringify({ assets: names.map(name => ({ name, size: 100 })) }));
} else process.exit(99);
`;

const curlStub = `#!/usr/bin/env node
const fs = require("node:fs");
const args = process.argv.slice(2);
fs.appendFileSync(process.env.PUBLISH_TEST_AUDIT, JSON.stringify(["curl", ...args]) + "\\n");
if (process.env.PUBLISH_TEST_DOWNLOAD_FAIL) process.exit(22);
const output = args[args.indexOf("--output") + 1];
if (output !== "/dev/null") {
  const url = args.at(-1).replace(/appcast.xml$/, "Meowbert-desktop-mac-universal.zip");
  fs.writeFileSync(output, '<rss><enclosure url="' + (process.env.PUBLISH_TEST_BAD_FEED ? "https://wrong/release.zip" : url) + '" sparkle:edSignature="signed" /></rss>');
}
`;

function publish(fixture, input = "\ny\n", overrides = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn("/bin/bash", [path.join(fixture.repository, "scripts/publish_release.sh")], {
      cwd: os.tmpdir(), env: { ...fixture.env, ...overrides }
    });
    let output = "";
    child.stdout.on("data", (data) => { output += data; });
    child.stderr.on("data", (data) => { output += data; });
    child.once("error", reject);
    child.once("close", (code) => resolve({ code, output }));
    child.stdin.on("error", () => {});
    child.stdin.end(input);
  });
}

test("publishes the suggested version from any directory and verifies the exact release", async (context) => {
  const f = await fixture(context);
  const result = await publish(f);
  assert.equal(result.code, 0, result.output);
  assert.match(result.output, /Published and verified: https:\/\/github.com\/test\/releases\/releases\/tag\/desktop-v2026.11.5/);
  assert.equal(JSON.parse(await readFile(path.join(f.repository, "apps/desktop/package.json"))).version, "2026.11.5");
  assert.equal(JSON.parse(await readFile(path.join(f.repository, "package-lock.json"))).packages["apps/desktop"].version, "2026.11.5");
  const sha = await git(f, "rev-parse", "HEAD");
  assert.equal(await git(f, "rev-parse", "desktop-v2026.11.5^{}"), sha);
  assert.match(await git(f, "ls-remote", "origin", "refs/heads/main"), new RegExp(`^${sha}\\s`));
  assert.match(await git(f, "ls-remote", "origin", "refs/tags/desktop-v2026.11.5^{}"), new RegExp(`^${sha}\\s`));
  assert.equal(await git(f, "status", "--porcelain"), "");
  const calls = (await readFile(f.audit, "utf8")).trim().split("\n").map(JSON.parse);
  const run = calls.find(call => call[1] === "run" && call[2] === "list");
  assert.equal(run[run.indexOf("--commit") + 1], sha);
  assert.equal(run[run.indexOf("--branch") + 1], "desktop-v2026.11.5");
  assert.equal(calls.filter(call => call[0] === "curl").length, 8);
});

test("cancelling leaves versions and local and remote history unchanged", async (context) => {
  const f = await fixture(context);
  const result = await publish(f, "\nn\n");
  assert.equal(result.code, 0, result.output);
  assert.match(result.output, /Cancelled/);
  assert.equal(await git(f, "rev-parse", "HEAD"), f.initialSha);
  assert.equal(await git(f, "tag", "--list"), "");
  assert.equal(await git(f, "status", "--porcelain"), "");
});

test("rejects a dirty working tree without committing it", async (context) => {
  const f = await fixture(context);
  await writeFile(path.join(f.repository, "draft.txt"), "do not publish");
  const result = await publish(f);
  assert.notEqual(result.code, 0);
  assert.match(result.output, /Commit or stash/);
  assert.equal(await git(f, "rev-parse", "HEAD"), f.initialSha);
});

test("rejects invalid versions before changing files", async (context) => {
  const f = await fixture(context);
  const result = await publish(f, "not-a-version\ny\n");
  assert.notEqual(result.code, 0);
  assert.match(result.output, /Enter a semantic version/);
  assert.equal(await git(f, "rev-parse", "HEAD"), f.initialSha);
  assert.equal(await git(f, "status", "--porcelain"), "");
});

test("refuses to overwrite a remote release tag", async (context) => {
  const f = await fixture(context);
  await git(f, "tag", "desktop-v2026.11.5");
  await git(f, "push", "origin", "desktop-v2026.11.5");
  await git(f, "tag", "-d", "desktop-v2026.11.5");
  const result = await publish(f);
  assert.notEqual(result.code, 0);
  assert.match(result.output, /Remote tag desktop-v2026.11.5 already exists/);
  assert.equal(await git(f, "rev-parse", "HEAD"), f.initialSha);
});

test("rejects build metadata unsupported by the appcast generator before changing files", async (context) => {
  const f = await fixture(context);
  const result = await publish(f, "2026.11.5+build.1\ny\n");
  assert.notEqual(result.code, 0);
  assert.match(result.output, /Build metadata/);
  assert.equal(await git(f, "status", "--porcelain"), "");
  assert.equal(await git(f, "rev-parse", "HEAD"), f.initialSha);
});

test("requires main before making a version commit", async (context) => {
  const f = await fixture(context);
  await git(f, "checkout", "-b", "development");
  const result = await publish(f);
  assert.notEqual(result.code, 0);
  assert.match(result.output, /Switch to main/);
  assert.equal(await git(f, "rev-parse", "HEAD"), f.initialSha);
});

for (const [failure, expected, exitCode] of [
  ["WORKFLOW_FAIL", /Release workflow failed/, 1],
  ["MISSING_ASSET", /Missing or empty release asset: appcast.xml/, 1],
  ["DOWNLOAD_FAIL", /Release tag: desktop-v2026.11.6/, 22],
  ["BAD_FEED", /Appcast ZIP URL does not match/, 1]
]) {
  test(`does not report publication success for ${failure}`, async (context) => {
    const f = await fixture(context);
    const result = await publish(f, "2026.11.6\ny\n", { [`PUBLISH_TEST_${failure}`]: "1" });
    assert.equal(result.code, exitCode, result.output);
    assert.match(result.output, expected);
    assert.doesNotMatch(result.output, /Published and verified/);
    assert.notEqual(await git(f, "rev-parse", "HEAD"), f.initialSha);
  });
}

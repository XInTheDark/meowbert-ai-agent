import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import {
  getDesktopVersion,
  setDesktopVersion,
  updateAndCommitDesktopVersion
} from "./desktop-version.mjs";

const execFileAsync = promisify(execFile);

async function runGit(directory, args) {
  return execFileAsync("git", args, { cwd: directory });
}

async function createFixture() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "meowbert-desktop-version-"));
  const packagePath = path.join(directory, "apps/desktop/package.json");
  const lockPath = path.join(directory, "package-lock.json");
  await mkdir(path.dirname(packagePath), { recursive: true });
  await writeFile(packagePath, `${JSON.stringify({
    name: "@meowbert/desktop",
    version: "0.1.0-beta.11"
  }, null, 2)}\n`);
  await writeFile(lockPath, `${JSON.stringify({
    packages: {
      "apps/desktop": {
        name: "@meowbert/desktop",
        version: "0.1.0-beta.11"
      }
    }
  }, null, 2)}\n`);
  return { directory, packagePath, lockPath };
}

async function initializeGitFixture(fixture) {
  await writeFile(path.join(fixture.directory, "notes.txt"), "initial\n");
  await runGit(fixture.directory, ["init", "-q"]);
  await runGit(fixture.directory, ["config", "user.name", "Desktop Version Test"]);
  await runGit(fixture.directory, ["config", "user.email", "desktop-version-test@example.com"]);
  await runGit(fixture.directory, ["add", "."]);
  await runGit(fixture.directory, ["commit", "-q", "-m", "initial"]);
}

test("reads the current desktop version", async (context) => {
  const fixture = await createFixture();
  context.after(() => rm(fixture.directory, { recursive: true, force: true }));

  assert.equal(await getDesktopVersion(fixture.packagePath), "0.1.0-beta.11");
});

test("updates the desktop package and lockfile versions", async (context) => {
  const fixture = await createFixture();
  context.after(() => rm(fixture.directory, { recursive: true, force: true }));

  assert.equal(await setDesktopVersion("0.1.0-beta.12", fixture), "0.1.0-beta.12");
  const packageJson = JSON.parse(await readFile(fixture.packagePath, "utf8"));
  const lockJson = JSON.parse(await readFile(fixture.lockPath, "utf8"));
  assert.equal(packageJson.version, "0.1.0-beta.12");
  assert.equal(lockJson.packages["apps/desktop"].version, "0.1.0-beta.12");
});

test("rejects invalid desktop versions without changing files", async (context) => {
  const fixture = await createFixture();
  context.after(() => rm(fixture.directory, { recursive: true, force: true }));

  await assert.rejects(
    setDesktopVersion("beta.12", fixture),
    /Expected an Electron-compatible semantic version/
  );
  assert.equal(await getDesktopVersion(fixture.packagePath), "0.1.0-beta.11");
});

test("updates only the version files and preserves unrelated staged changes", async (context) => {
  const fixture = await createFixture();
  context.after(() => rm(fixture.directory, { recursive: true, force: true }));
  await initializeGitFixture(fixture);
  await writeFile(path.join(fixture.directory, "notes.txt"), "unrelated change\n");
  await runGit(fixture.directory, ["add", "notes.txt"]);

  const result = await updateAndCommitDesktopVersion("2026.8.1", fixture.directory);
  const latestSubject = await runGit(fixture.directory, ["log", "-1", "--pretty=%s"]);
  const committedPaths = await runGit(fixture.directory, ["show", "--pretty=", "--name-only", "HEAD"]);
  const status = await runGit(fixture.directory, ["status", "--porcelain"]);

  assert.equal(result.committed, true);
  assert.match(result.commit, /^[0-9a-f]+$/);
  assert.equal(latestSubject.stdout.trim(), "chore(desktop): bump version to 2026.8.1");
  assert.deepEqual(committedPaths.stdout.trim().split("\n").sort(), [
    "apps/desktop/package.json",
    "package-lock.json"
  ]);
  assert.equal(status.stdout.trim(), "M  notes.txt");
});

test("does not create a commit when the version is already current", async (context) => {
  const fixture = await createFixture();
  context.after(() => rm(fixture.directory, { recursive: true, force: true }));
  await initializeGitFixture(fixture);

  const result = await updateAndCommitDesktopVersion("0.1.0-beta.11", fixture.directory);
  const commitCount = await runGit(fixture.directory, ["rev-list", "--count", "HEAD"]);

  assert.deepEqual(result, {
    version: "0.1.0-beta.11",
    committed: false,
    commit: null
  });
  assert.equal(commitCount.stdout.trim(), "1");
});

test("refuses to absorb existing version-file changes", async (context) => {
  const fixture = await createFixture();
  context.after(() => rm(fixture.directory, { recursive: true, force: true }));
  await initializeGitFixture(fixture);
  await writeFile(fixture.packagePath, "{}\n");

  await assert.rejects(
    updateAndCommitDesktopVersion("2026.8.1", fixture.directory),
    /version files already have changes/
  );
  const commitCount = await runGit(fixture.directory, ["rev-list", "--count", "HEAD"]);
  assert.equal(commitCount.stdout.trim(), "1");
});

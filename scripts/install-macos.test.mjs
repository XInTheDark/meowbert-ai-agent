import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const installer = fileURLToPath(new URL("./install-macos.sh", import.meta.url));
const macTest = process.platform === "darwin" ? test : test.skip;
const releaseBase = "https://github.com/XInTheDark/meowbert-ai-releases/releases";
const archiveName = "Meowbert-desktop-mac-universal.zip";

function latestMacManifest(sha512) {
  return `version: 2099.1.1
files:
  - url: Meowbert-desktop-mac-universal.dmg
    sha512: ${"B".repeat(86)}==
  - url: ${archiveName}
    sha512: ${sha512}
path: ${archiveName}
`;
}

async function createApp(directory, version, bundleId = "ai.meowbert.desktop") {
  await mkdir(path.join(directory, "Contents/MacOS"), { recursive: true });
  await writeFile(path.join(directory, "Contents/Info.plist"), `<?xml version="1.0"?>
<plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>${bundleId}</string>
<key>CFBundleShortVersionString</key><string>${version}</string>
</dict></plist>
`);
  await writeFile(path.join(directory, "Contents/MacOS/Meowbert"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  await writeFile(path.join(directory, "version.txt"), version);
}

async function createFixture(context, bundleId) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "meowbert-installer-test-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const applications = path.join(directory, "Test Applications");
  const temporary = path.join(directory, "downloads");
  const bin = path.join(directory, "bin");
  await Promise.all([applications, temporary, bin].map((item) => mkdir(item)));
  const app = path.join(directory, "Meowbert.app");
  await createApp(app, "2099.1.1", bundleId);
  const archive = path.join(directory, archiveName);
  await execFileAsync("/usr/bin/ditto", ["-c", "-k", "--keepParent", app, archive]);
  const checksum = createHash("sha512").update(await readFile(archive)).digest("base64");
  const sums = path.join(directory, "latest-mac.yml");
  await writeFile(sums, latestMacManifest(checksum));
  await writeFile(path.join(bin, "curl"), `#!/bin/bash
while [[ $# -gt 0 ]]; do
  case "$1" in
    --output|-o) output="$2"; shift 2 ;;
    *) url="$1"; shift ;;
  esac
done
printf '%s\n' "$url" >> "$FIXTURE_CURL_LOG"
case "$url" in
  */latest) printf '%s/tag/desktop-v2099.1.1' "${releaseBase}" ;;
  */download/desktop-v2099.1.1/${archiveName}) /bin/cp "$FIXTURE_ARCHIVE" "$output" ;;
  */download/desktop-v2099.1.1/latest-mac.yml) /bin/cp "$FIXTURE_SUMS" "$output" ;;
  *) exit 22 ;;
esac
`, { mode: 0o755 });
  await writeFile(path.join(bin, "pgrep"), "#!/bin/bash\nexit \"${FIXTURE_APP_RUNNING:-1}\"\n", { mode: 0o755 });
  await writeFile(path.join(bin, "mv"), `#!/bin/bash
if [[ "$FIXTURE_FAIL_INSTALL" == 1 && "$1" == */next.app ]]; then exit 1; fi
exec /bin/mv "$@"
`, { mode: 0o755 });
  const env = {
    ...process.env,
    PATH: `${bin}:${process.env.PATH}`,
    TMPDIR: temporary,
    MEOWBERT_INSTALL_DIR: applications,
    FIXTURE_ARCHIVE: archive,
    FIXTURE_SUMS: sums,
    FIXTURE_CURL_LOG: path.join(directory, "curl.log")
  };
  return { applications, temporary, sums, env, destination: path.join(applications, "Meowbert.app") };
}

async function assertClean(fixture) {
  assert.deepEqual(await readdir(fixture.temporary), []);
  assert.deepEqual((await readdir(fixture.applications)).filter((name) => name.startsWith(".meowbert-install.")), []);
}

macTest("installs the resolved latest release and removes its downloads", async (context) => {
  const fixture = await createFixture(context);
  const result = await execFileAsync("/bin/bash", [installer], { env: fixture.env });
  assert.match(result.stdout, /Installed Meowbert 2099\.1\.1/);
  assert.equal(await readFile(path.join(fixture.destination, "version.txt"), "utf8"), "2099.1.1");
  const requests = (await readFile(fixture.env.FIXTURE_CURL_LOG, "utf8")).trim().split("\n");
  assert.deepEqual(requests, [
    `${releaseBase}/latest`,
    `${releaseBase}/download/desktop-v2099.1.1/${archiveName}`,
    `${releaseBase}/download/desktop-v2099.1.1/latest-mac.yml`
  ]);
  await assertClean(fixture);
});

macTest("replaces an existing app without leaving its old bundle behind", async (context) => {
  const fixture = await createFixture(context);
  await createApp(fixture.destination, "2098.1.1");
  await writeFile(path.join(fixture.destination, "old-only.txt"), "obsolete");
  await execFileAsync("/bin/bash", [installer], { env: fixture.env });
  assert.equal(await readFile(path.join(fixture.destination, "version.txt"), "utf8"), "2099.1.1");
  assert.equal((await readdir(fixture.destination)).includes("old-only.txt"), false);
  await assertClean(fixture);
});

macTest("rejects a corrupt download and preserves the existing app", async (context) => {
  const fixture = await createFixture(context);
  await createApp(fixture.destination, "2098.1.1");
  await writeFile(fixture.sums, latestMacManifest(`${"A".repeat(86)}==`));
  await assert.rejects(execFileAsync("/bin/bash", [installer], { env: fixture.env }), /checksum did not match/);
  assert.equal(await readFile(path.join(fixture.destination, "version.txt"), "utf8"), "2098.1.1");
  await assertClean(fixture);
});

macTest("rejects a different app even when its archive checksum matches", async (context) => {
  const fixture = await createFixture(context, "example.unrelated");
  await assert.rejects(execFileAsync("/bin/bash", [installer], { env: fixture.env }), /not the Meowbert desktop app/);
  assert.deepEqual(await readdir(fixture.applications), []);
  await assertClean(fixture);
});

macTest("restores the old app if placing the new app fails", async (context) => {
  const fixture = await createFixture(context);
  await createApp(fixture.destination, "2098.1.1");
  await assert.rejects(execFileAsync("/bin/bash", [installer], { env: { ...fixture.env, FIXTURE_FAIL_INSTALL: "1" } }));
  assert.equal(await readFile(path.join(fixture.destination, "version.txt"), "utf8"), "2098.1.1");
  await assertClean(fixture);
});

macTest("refuses to replace a running app before downloading anything", async (context) => {
  const fixture = await createFixture(context);
  await assert.rejects(execFileAsync("/bin/bash", [installer], { env: { ...fixture.env, FIXTURE_APP_RUNNING: "0" } }), /Quit Meowbert/);
  await assert.rejects(readFile(fixture.env.FIXTURE_CURL_LOG), { code: "ENOENT" });
  await assertClean(fixture);
});

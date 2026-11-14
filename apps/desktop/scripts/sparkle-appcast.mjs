import { spawn } from "node:child_process";
import { createPrivateKey, createPublicKey } from "node:crypto";
import { copyFile, mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const config = require("../electron-builder.config.cjs");
const { version } = require("../package.json");

export function validateSigningKey(privateKey, publicKey) {
  const seed = Buffer.from(privateKey?.trim() ?? "", "base64");
  if (seed.length !== 32) throw new Error("SPARKLE_ED_PRIVATE_KEY must contain the Sparkle Ed25519 private seed.");
  const key = createPrivateKey({
    key: Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), seed]),
    format: "der", type: "pkcs8"
  });
  const derivedPublicKey = createPublicKey(key).export({ format: "der", type: "spki" }).subarray(-32).toString("base64");
  if (derivedPublicKey !== publicKey) throw new Error("Sparkle signing key does not match the public key embedded in the app.");
}

function runSparkle(arguments_, privateKey) {
  const cli = path.join(path.dirname(require.resolve("electron-sparkle/package.json")), "dist/cli.js");
  const env = { ...process.env };
  delete env.SPARKLE_ED_PRIVATE_KEY;
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cli, ...arguments_], { env, stdio: ["pipe", "inherit", "inherit"] });
    child.once("error", reject);
    child.stdin.on("error", reject);
    child.once("close", (code) => code === 0 ? resolve() : reject(new Error(`Sparkle tool exited with ${code}.`)));
    child.stdin.end(privateKey);
  });
}

export async function generateSparkleAppcast({ artifactsDirectory, releaseTag, privateKey }) {
  validateSigningKey(privateKey, config.mac.extendInfo.SUPublicEDKey);
  if (!/^desktop-[A-Za-z0-9][A-Za-z0-9._-]*$/.test(releaseTag ?? "")) throw new Error("A desktop release tag is required.");
  const publisher = config.publish[0];
  const downloadPrefix = `https://github.com/${publisher.owner}/${publisher.repo}/releases/download/${encodeURIComponent(releaseTag)}/`;
  await mkdir(artifactsDirectory, { recursive: true });
  const staging = await mkdtemp(path.join(artifactsDirectory, ".sparkle-"));
  try {
    const archive = "Meowbert-desktop-mac-universal.zip";
    await copyFile(path.join(artifactsDirectory, archive), path.join(staging, archive));
    const appcast = path.join(staging, "appcast.xml");
    await runSparkle([
      "generate-appcast", "--ed-key-file", "-", "--download-url-prefix", downloadPrefix,
      "--maximum-deltas", "0", "--maximum-versions", "1", "-o", appcast, staging
    ], privateKey);
    const signature = /sparkle:edSignature="([^"]+)"/.exec(await readFile(appcast, "utf8"))?.[1];
    if (!signature) throw new Error("Sparkle did not sign the update archive.");
    await runSparkle(["sign-update", "--verify", "--ed-key-file", "-", path.join(staging, archive), signature], privateKey);
    await runSparkle(["sign-update", "--ed-key-file", "-", appcast], privateKey);
    await runSparkle(["sign-update", "--verify", "--ed-key-file", "-", appcast], privateKey);
    const output = path.join(artifactsDirectory, "appcast.xml");
    await copyFile(appcast, output);
    return output;
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  await generateSparkleAppcast({
    artifactsDirectory: path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../dist-packages"),
    releaseTag: process.env.RELEASE_TAG ?? `desktop-v${version}`,
    privateKey: process.env.SPARKLE_ED_PRIVATE_KEY
  });
}

import { generateKeyPairSync } from "node:crypto";
import assert from "node:assert/strict";
import { test } from "node:test";
import { validateSigningKey, generateSparkleAppcast } from "./sparkle-appcast.mjs";

const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const seed = privateKey.export({ format: "der", type: "pkcs8" }).subarray(-32).toString("base64");
const publicBytes = publicKey.export({ format: "der", type: "spki" }).subarray(-32).toString("base64");

test("accepts the signing seed paired with the app's embedded verification key", () => {
  assert.doesNotThrow(() => validateSigningKey(seed, publicBytes));
});

test("rejects a missing or invalid signing secret before generating a feed", () => {
  for (const value of [undefined, "", "not a signing key"]) {
    assert.throws(() => validateSigningKey(value, publicBytes), /SPARKLE_ED_PRIVATE_KEY/);
  }
});

test("rejects a different signing key so existing installations can verify updates", () => {
  assert.throws(() => validateSigningKey(seed, Buffer.alloc(32).toString("base64")), /does not match/);
});

test("fails before writing artifacts when release signing is not configured", async () => {
  await assert.rejects(generateSparkleAppcast({ artifactsDirectory: "/does-not-exist", releaseTag: "desktop-v1.0.0" }), /SPARKLE_ED_PRIVATE_KEY/);
});

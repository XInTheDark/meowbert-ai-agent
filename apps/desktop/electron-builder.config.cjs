const { resolveDesktopReleaseEnv } = require("../../config/desktop-release.cjs");
const { version } = require("./package.json");
const DESKTOP_RELEASE_TAG_PREFIX = process.env.RELEASE_TAG === `desktop-${version}` ? "desktop-" : "desktop-v";
const { publicKey } = require("../../config/desktop-sparkle.json");
const sparklePublicKey = process.env.MEOWBERT_SPARKLE_PUBLIC_KEY || publicKey;
if (!/^[A-Za-z0-9+/]{43}=$/.test(sparklePublicKey)) {
  throw new Error("MEOWBERT_SPARKLE_PUBLIC_KEY must be a base64 Ed25519 public key.");
}

const [releaseOwner, releaseRepo] = resolveDesktopReleaseEnv().repository.split("/");

module.exports = {
  appId: "ai.meowbert.desktop",
  productName: "Meowbert",
  directories: {
    output: "dist-packages"
  },
  files: [
    "dist/**/*",
    "!dist/host-skills/**/*",
    "!dist/live-folder-runtime/**/*",
    "!node_modules/electron-sparkle/dist/Sparkle-*.zip",
    "!node_modules/electron-sparkle/dist/electron_sparkle.darwin-*.node",
    // ssh2's optional install-time binding targets build-host Node, not Electron.
    "!node_modules/ssh2/lib/protocol/crypto/build/**/*",
    { from: "../../prompt-texts", to: "node_modules/prompt-texts", filter: ["**/*.md"] }
  ],
  asar: true,
  extraResources: [{ from: "dist/host-skills", to: "host-skills" }, { from: "dist/live-folder-runtime", to: "live-folder-runtime" }],
  icon: "build/icon.png",
  afterPack: require("electron-sparkle/electron-builder").electronSparkle,
  mac: {
    identity: "-",
    hardenedRuntime: false,
    minimumSystemVersion: "14.0",
    extendInfo: {
      SUFeedURL: `https://github.com/${releaseOwner}/${releaseRepo}/releases/latest/download/appcast.xml`,
      SUPublicEDKey: sparklePublicKey,
      SUEnableAutomaticChecks: true,
      SUAutomaticallyUpdate: true,
      SUAllowsAutomaticUpdates: true,
      SUScheduledCheckInterval: 21600
    },
    category: "public.app-category.developer-tools",
    icon: "build/icon.icns",
    // Both pinned helper architectures intentionally ship in every app.
    x64ArchFiles: "Contents/Resources/live-folder-runtime/rclone-{x64,arm64}",
    target: [
      "dmg",
      "zip"
    ],
    artifactName: "${productName}-desktop-mac-${arch}.${ext}"
  },
  win: {
    icon: "build/icon.ico",
    target: [
      "nsis",
      "zip"
    ],
    artifactName: "${productName}-desktop-win-${arch}.${ext}"
  },
  electronVersion: require("./package.json").devDependencies.electron,
  publish: [
    {
      provider: "github",
      owner: releaseOwner,
      repo: releaseRepo,
      releaseType: "release",
      tagNamePrefix: DESKTOP_RELEASE_TAG_PREFIX
    }
  ]
};

const { resolveDesktopReleaseEnv } = require("../../config/desktop-release.cjs");
const DESKTOP_RELEASE_TAG_PREFIX = "desktop-v";

const [releaseOwner, releaseRepo] = resolveDesktopReleaseEnv().repository.split("/");

module.exports = {
  appId: "ai.meowbert.desktop",
  productName: "Meowbert",
  directories: {
    output: "dist-packages"
  },
  files: [
    "dist/**/*",
    // ssh2's optional install-time binding targets build-host Node, not Electron.
    "!node_modules/ssh2/lib/protocol/crypto/build/**/*",
    { from: "../../prompt-texts", to: "node_modules/prompt-texts", filter: ["**/*.md"] }
  ],
  asar: true,
  extraResources: [{ from: "dist/host-skills", to: "host-skills" }, { from: "dist/live-folder-runtime", to: "live-folder-runtime" }],
  icon: "build/icon.png",
  mac: {
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
  electronVersion: "40.8.0",
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

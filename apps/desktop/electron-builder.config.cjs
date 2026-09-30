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
    "dist/**/*"
  ],
  asar: true,
  icon: "build/icon.png",
  mac: {
    category: "public.app-category.developer-tools",
    icon: "build/icon.icns",
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

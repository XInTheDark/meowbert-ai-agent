import path from "node:path";
import { createRequire } from "node:module";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";

const require = createRequire(import.meta.url);
const { resolveDesktopReleaseEnv } = require("../../config/desktop-release.cjs");
const desktopReleaseEnv = resolveDesktopReleaseEnv();
const sharedSourcePath = path.resolve(__dirname, "../../packages/shared/src");
const desktopAlias = {
  "@desktop": path.resolve(__dirname, "src"),
  "@web": path.resolve(__dirname, "../web/src"),
  "@meowbert/shared": sharedSourcePath
};
const desktopReleaseDefines = {
  "import.meta.env.VITE_DESKTOP_RELEASE_REPOSITORY": JSON.stringify(desktopReleaseEnv.env.VITE_DESKTOP_RELEASE_REPOSITORY),
  "import.meta.env.VITE_DESKTOP_RELEASES_PAGE_URL": JSON.stringify(desktopReleaseEnv.env.VITE_DESKTOP_RELEASES_PAGE_URL)
};

export default defineConfig({
  main: {
    define: desktopReleaseDefines,
    build: {
      outDir: "dist/main"
    },
    resolve: {
      alias: desktopAlias
    },
    plugins: [externalizeDepsPlugin()]
  },
  preload: {
    build: {
      outDir: "dist/preload"
    },
    resolve: {
      alias: desktopAlias
    },
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
    define: desktopReleaseDefines,
    root: "src/renderer",
    build: {
      outDir: "dist/renderer"
    },
    plugins: [react()],
    resolve: {
      alias: desktopAlias
    },
    server: {
      fs: {
        allow: [path.resolve(__dirname, "../..")]
      }
    }
  }
});

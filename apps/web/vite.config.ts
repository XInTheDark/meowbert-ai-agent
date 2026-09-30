import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { resolveDesktopReleaseEnv } = require("../../config/desktop-release.cjs");
const desktopReleaseEnv = resolveDesktopReleaseEnv();

function normalizeAllowedHost(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  try {
    return new URL(trimmed).host;
  } catch {
    return trimmed.replace(/^https?:\/\//, "").split("/")[0] ?? null;
  }
}

function getAllowedHosts(): string[] {
  return [
    process.env.VITE_ALLOWED_HOSTS,
    process.env.SERVICE_FQDN_WEB,
    process.env.SERVICE_URL_WEB,
    process.env.COOLIFY_FQDN
  ]
    .flatMap((value) => (value ?? "").split(","))
    .map((host) => normalizeAllowedHost(host))
    .filter((host): host is string => Boolean(host));
}

const allowedHosts = getAllowedHosts();

export default defineConfig({
  plugins: [react()],
  define: {
    "import.meta.env.VITE_DESKTOP_RELEASE_REPOSITORY": JSON.stringify(desktopReleaseEnv.env.VITE_DESKTOP_RELEASE_REPOSITORY),
    "import.meta.env.VITE_DESKTOP_RELEASES_PAGE_URL": JSON.stringify(desktopReleaseEnv.env.VITE_DESKTOP_RELEASES_PAGE_URL)
  },
  resolve: {
    alias: {
      "@meowbert/shared": path.resolve(__dirname, "../../packages/shared/src")
    }
  },
  server: {
    host: "0.0.0.0",
    port: 5173,
    allowedHosts,
    fs: {
      allow: [path.resolve(__dirname, "../..")]
    }
  },
  preview: {
    host: "0.0.0.0",
    port: 5173,
    allowedHosts
  }
});

import type { ReactNode } from "react";
import { apiBaseUrl } from "../../lib/runtime";

const TRUSTED_DOWNLOAD_PATH = /^\/api\/(?:projects|workspaces)\/[^/]+\/files\/download(?:\/batch)?$/;
const RUNTIME_PROJECT_FILE_PATH = /^\/app\/runtime\/(?:[^/?#]+\/)*environments\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/root\/(.+)$/i;

export function resolveRuntimeFileDownloadPath(href: string | undefined): string | null {
  if (!href || href.includes("?") || href.includes("#")) {
    return null;
  }

  const match = RUNTIME_PROJECT_FILE_PATH.exec(href);
  if (!match) {
    return null;
  }

  try {
    const relativePath = decodeURIComponent(match[2]);
    if (relativePath.split("/").some((segment) => segment === "." || segment === "..")) {
      return null;
    }
    return `/api/projects/${match[1]}/files/download?path=${encodeURIComponent(relativePath)}`;
  } catch {
    return null;
  }
}

export function resolveTrustedMarkdownDownloadUrl(href: string | undefined): string | null {
  if (!href) {
    return null;
  }

  try {
    const apiUrl = new URL(apiBaseUrl());
    const resolvedUrl = new URL(href, apiUrl);
    if (resolvedUrl.origin !== apiUrl.origin || !TRUSTED_DOWNLOAD_PATH.test(resolvedUrl.pathname)) {
      return null;
    }

    return resolvedUrl.toString();
  } catch {
    return null;
  }
}

export function resolveMarkdownDownloadFilename(href: string, fallbackName?: ReactNode): string {
  try {
    const urlObj = new URL(href, typeof window !== "undefined" ? window.location.origin : "http://localhost");
    if (urlObj.pathname.endsWith("/batch")) {
      return "selected-files.zip";
    }

    const pathParam = urlObj.searchParams.get("path") || urlObj.searchParams.get("paths");
    if (pathParam) {
      const filename = pathParam.split("/").filter(Boolean).pop();
      if (filename) {
        return filename;
      }
    }

    const pathnameFilename = urlObj.pathname.split("/").filter(Boolean).pop();
    if (pathnameFilename && pathnameFilename !== "download") {
      return pathnameFilename;
    }
  } catch {
    const fallback = href.split("/").filter(Boolean).pop()?.split("?")[0];
    if (fallback && fallback !== "download" && fallback !== "batch") {
      return fallback;
    }
  }

  if (typeof fallbackName === "string") {
    const trimmed = fallbackName.trim();
    if (trimmed.length > 0 && !trimmed.includes("/") && !trimmed.includes("\\") && !trimmed.startsWith("http")) {
      return trimmed;
    }
  }

  return "download";
}

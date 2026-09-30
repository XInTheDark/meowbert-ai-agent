import { apiBaseUrl } from "./api";

const DEFAULT_DOCS_BASE_URL = "http://localhost:4173";

function resolveEnvDocsBaseUrl(): string | null {
  const configured = import.meta.env.VITE_DOCS_URL;
  if (typeof configured === "string" && configured.trim().length > 0) {
    return configured.trim().replace(/\/$/, "");
  }

  return null;
}

export function docsBaseUrl(): string {
  const envDocsUrl = resolveEnvDocsBaseUrl();
  if (envDocsUrl) {
    return envDocsUrl;
  }

  return DEFAULT_DOCS_BASE_URL;
}

export function buildDocsUrl(path: string): string {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const envDocsUrl = resolveEnvDocsBaseUrl();
  if (envDocsUrl) {
    return `${envDocsUrl}${normalizedPath}`;
  }

  const redirectUrl = new URL(`${apiBaseUrl()}/api/public/docs`);
  redirectUrl.searchParams.set("path", normalizedPath);
  return redirectUrl.toString();
}

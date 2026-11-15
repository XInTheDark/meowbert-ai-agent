// Maps an in-app route onto the server's web app so it can be opened in a regular browser.
export function resolveBrowserPageUrl(input: { webBaseUrl: string | null | undefined; route: string }): string | null {
  const base = input.webBaseUrl?.trim();
  if (!base) {
    return null;
  }

  try {
    const baseUrl = new URL(base.endsWith("/") ? base : `${base}/`);
    if (baseUrl.protocol !== "http:" && baseUrl.protocol !== "https:") {
      return null;
    }
    const route = input.route.startsWith("/") ? input.route.slice(1) : input.route;
    return new URL(route, baseUrl).toString();
  } catch {
    return null;
  }
}

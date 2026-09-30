const WEB_PUSH_PROVIDER_HOST_SUFFIXES = [
  "fcm.googleapis.com",
  "push.services.mozilla.com",
  "push.apple.com",
  "notify.windows.com"
] as const;

export function isAllowedWebPushEndpoint(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.port) {
      return false;
    }

    const hostname = url.hostname.toLowerCase();
    return WEB_PUSH_PROVIDER_HOST_SUFFIXES.some((suffix) =>
      hostname === suffix || hostname.endsWith(`.${suffix}`)
    );
  } catch {
    return false;
  }
}

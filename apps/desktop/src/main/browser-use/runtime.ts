import { createHostBrowserService } from "./service";
let browser: ReturnType<typeof createHostBrowserService> | null = null;
export function getHostBrowser(userData: string) {
  return browser ??= createHostBrowserService(userData);
}

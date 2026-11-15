import { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import type { FlashMessage } from "../lib/types";
import type { PlatformAdapter, PublicServerConfig } from "./platform";
import { resolveBrowserPageUrl } from "./browserPageUrl";

interface DesktopOpenInBrowserListenerProps {
  platform: PlatformAdapter;
  publicServerConfig: PublicServerConfig | null;
  serverBaseUrl: string | null;
  setFlash: (flash: FlashMessage | null) => void;
}

// Opens the page the desktop app is showing in the default browser when the File menu asks for it.
export function DesktopOpenInBrowserListener(props: DesktopOpenInBrowserListenerProps) {
  const location = useLocation();
  const latest = useRef({ ...props, location });
  latest.current = { ...props, location };

  useEffect(() => props.platform.onOpenInBrowserRequested(() => {
    const { publicServerConfig, serverBaseUrl, setFlash, platform, location: current } = latest.current;
    const url = resolveBrowserPageUrl({
      webBaseUrl: publicServerConfig?.appUrl ?? publicServerConfig?.publicUrl ?? serverBaseUrl,
      route: `${current.pathname}${current.search}${current.hash}`
    });
    if (!url) {
      setFlash({ tone: "error", text: "This server has no web address to open." });
      return;
    }
    void platform.openExternal(url);
  }), [props.platform]);

  return null;
}

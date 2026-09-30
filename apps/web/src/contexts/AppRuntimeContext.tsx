import { createContext, useContext } from "react";
import {
  type DesktopActiveContext,
  type PlatformAdapter,
  type PlatformCapabilities,
  type PublicServerConfig,
  type ServerProfile,
  type ServerProfilesState
} from "../desktop/platform";
import type { DesktopShortcutPreferences } from "../desktop/desktopShortcuts";

export interface AppRuntimeContextValue {
  platform: PlatformAdapter;
  capabilities: PlatformCapabilities;
  serverProfilesState: ServerProfilesState;
  activeServerProfile: ServerProfile | null;
  saveServerProfilesState: (state: ServerProfilesState) => Promise<void>;
  shortcutPreferences: DesktopShortcutPreferences;
  saveShortcutPreferences: (state: DesktopShortcutPreferences) => Promise<void>;
  activeContext: DesktopActiveContext;
  saveActiveContext: (state: DesktopActiveContext) => Promise<void>;
  publicServerConfig: PublicServerConfig | null;
  refreshPublicServerConfig: () => Promise<void>;
}

export const AppRuntimeContext = createContext<AppRuntimeContextValue | null>(null);

export function useAppRuntime(): AppRuntimeContextValue {
  const context = useContext(AppRuntimeContext);
  if (!context) {
    throw new Error("useAppRuntime must be used within AppRuntimeContext");
  }
  return context;
}

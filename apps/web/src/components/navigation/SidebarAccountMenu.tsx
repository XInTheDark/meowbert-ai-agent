import { NavLink, useNavigate } from "react-router-dom";
import { Cable, Keyboard, LogOut, SlidersHorizontal } from "lucide-react";
import { ThemeSwitch } from "../theme/ThemeSwitch";
import { ThemeMode, UserProfile } from "../../lib/types";
import { SidebarMenu } from "./SidebarMenu";
import type { PlatformCapabilities, ServerProfile } from "../../desktop/platform";

interface SidebarAccountMenuProps {
  user: UserProfile | null;
  activeWorkspaceId: string | null;
  themeMode: ThemeMode;
  setThemeMode: (mode: ThemeMode) => void;
  isRail: boolean;
  capabilities: PlatformCapabilities;
  activeServerProfile: ServerProfile | null;
  onLogout: () => void;
  onMobileClose: () => void;
}

export function accountInitials(displayName?: string | null, email?: string | null): string {
  const source = displayName?.trim() || email?.split("@")[0] || "";
  const words = source.split(/[\s._-]+/).filter(Boolean);
  if (words.length === 0) {
    return "?";
  }
  if (words.length === 1) {
    return words[0].slice(0, 2).toUpperCase();
  }
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}

export function SidebarAccountMenu({
  user,
  activeWorkspaceId,
  themeMode,
  setThemeMode,
  isRail,
  capabilities,
  activeServerProfile,
  onLogout,
  onMobileClose
}: SidebarAccountMenuProps) {
  const navigate = useNavigate();

  return (
    <SidebarMenu
      label={user?.display_name || user?.email || "Account"}
      triggerClassName={`sidebar-account-trigger${isRail ? " rail" : ""}`}
      trigger={
        <>
          <span className="sidebar-avatar" aria-hidden="true">
            {accountInitials(user?.display_name, user?.email)}
          </span>
          {isRail ? null : (
            <span className="sidebar-account-identity">
              <strong>{user?.display_name || "User"}</strong>
              <span className="muted-text">{user?.email}</span>
            </span>
          )}
        </>
      }
    >
      {(close) => (
        <>
          <div className="sidebar-menu-header">
            <strong>{user?.display_name || "User"}</strong>
            <span className="muted-text">{user?.email}</span>
          </div>

          <div className="sidebar-menu-theme">
            <ThemeSwitch themeMode={themeMode} setThemeMode={setThemeMode} />
          </div>

          <div className="sidebar-menu-group">
            <NavLink
              to={`/app/${activeWorkspaceId}/preferences`}
              className="sidebar-menu-item"
              role="menuitem"
              onClick={() => {
                close();
                onMobileClose();
              }}
            >
              <SlidersHorizontal size={15} />
              <span>Preferences</span>
            </NavLink>

            {capabilities.supportsServerProfiles ? (
              <button
                type="button"
                className="sidebar-menu-item"
                role="menuitem"
                onClick={() => {
                  close();
                  onMobileClose();
                  navigate("/servers");
                }}
              >
                <Cable size={15} />
                <span>{activeServerProfile ? `Server: ${activeServerProfile.label}` : "Choose Server"}</span>
              </button>
            ) : null}

            {capabilities.isDesktop ? (
              <button
                type="button"
                className="sidebar-menu-item"
                role="menuitem"
                onClick={() => {
                  close();
                  onMobileClose();
                  navigate("/desktop/preferences");
                }}
              >
                <Keyboard size={15} />
                <span>Desktop Preferences</span>
              </button>
            ) : null}
          </div>

          <div className="sidebar-menu-group">
            <button
              type="button"
              className="sidebar-menu-item danger"
              role="menuitem"
              onClick={() => {
                close();
                onMobileClose();
                onLogout();
              }}
            >
              <LogOut size={15} />
              <span>Log out</span>
            </button>
          </div>
        </>
      )}
    </SidebarMenu>
  );
}

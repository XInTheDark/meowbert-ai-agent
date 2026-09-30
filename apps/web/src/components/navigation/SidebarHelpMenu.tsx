import { NavLink } from "react-router-dom";
import {
  BookOpen,
  CircleQuestionMark,
  Download,
  GraduationCap,
  Megaphone,
  Newspaper
} from "lucide-react";
import { SidebarMenu } from "./SidebarMenu";
import type { PlatformCapabilities } from "../../desktop/platform";

interface SidebarHelpMenuProps {
  isRail: boolean;
  hasHelpUnread: boolean;
  hasUnseen: boolean;
  hasUnreadAnnouncements: boolean;
  docsHomeUrl: string;
  isTutorialRunning: boolean;
  hasInProgressTutorial: boolean;
  tutorialActionLabel: string;
  desktopDownloadUrl: string;
  desktopDownloadLabel: string;
  capabilities: PlatformCapabilities;
  onSetHasUnseen: (value: boolean) => void;
  onOpenAnnouncements: () => void;
  onOpenTutorial: () => void;
  onRestartTutorial: () => void;
  onMobileClose: () => void;
}

export function SidebarHelpMenu({
  isRail,
  hasHelpUnread,
  hasUnseen,
  hasUnreadAnnouncements,
  docsHomeUrl,
  isTutorialRunning,
  hasInProgressTutorial,
  tutorialActionLabel,
  desktopDownloadUrl,
  desktopDownloadLabel,
  capabilities,
  onSetHasUnseen,
  onOpenAnnouncements,
  onOpenTutorial,
  onRestartTutorial,
  onMobileClose
}: SidebarHelpMenuProps) {
  return (
    <SidebarMenu
      label="Help and resources"
      triggerClassName={`sidebar-help-trigger${isRail ? " rail" : ""}`}
      hasUnread={hasHelpUnread}
      trigger={
        <>
          <CircleQuestionMark size={isRail ? 18 : 16} />
          {isRail ? null : <span>Help</span>}
        </>
      }
    >
      {(close) => (
        <>
          <div className="sidebar-menu-group">
            <a
              className="sidebar-menu-item"
              href={docsHomeUrl}
              target="_blank"
              rel="noreferrer"
              role="menuitem"
              onClick={close}
            >
              <BookOpen size={15} />
              <span>Docs</span>
            </a>
            <button
              type="button"
              className="sidebar-menu-item"
              role="menuitem"
              disabled={isTutorialRunning}
              onClick={() => {
                close();
                onMobileClose();
                onOpenTutorial();
              }}
            >
              <GraduationCap size={15} />
              <span>{isTutorialRunning ? "Tutorial Running..." : tutorialActionLabel}</span>
            </button>
            {hasInProgressTutorial ? (
              <button
                type="button"
                className="sidebar-menu-item"
                role="menuitem"
                disabled={isTutorialRunning}
                onClick={() => {
                  close();
                  onMobileClose();
                  onRestartTutorial();
                }}
              >
                <GraduationCap size={15} />
                <span>Restart Tutorial</span>
              </button>
            ) : null}
          </div>

          <div className="sidebar-menu-group">
            <NavLink
              to="/changelog"
              className="sidebar-menu-item"
              role="menuitem"
              onClick={() => {
                onSetHasUnseen(false);
                close();
                onMobileClose();
              }}
            >
              <Newspaper size={15} />
              <span>What's New</span>
              {hasUnseen ? <span className="sidebar-menu-item-dot" aria-label="unread" /> : null}
            </NavLink>
            <button
              type="button"
              className="sidebar-menu-item"
              role="menuitem"
              onClick={() => {
                onOpenAnnouncements();
                close();
              }}
            >
              <Megaphone size={15} />
              <span>Announcements</span>
              {hasUnreadAnnouncements ? <span className="sidebar-menu-item-dot" aria-label="unread" /> : null}
            </button>
          </div>

          {!capabilities.isDesktop ? (
            <div className="sidebar-menu-group">
              <a
                className="sidebar-menu-item"
                href={desktopDownloadUrl}
                target="_blank"
                rel="noreferrer"
                title={desktopDownloadLabel}
                role="menuitem"
                onClick={close}
              >
                <Download size={15} />
                <span>Download Desktop App</span>
              </a>
            </div>
          ) : null}
        </>
      )}
    </SidebarMenu>
  );
}

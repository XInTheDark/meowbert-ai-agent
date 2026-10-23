import { useEffect, useState } from "react";
import { useWorkspaceApp } from "../../contexts/WorkspaceContext";
import { useAppRuntime } from "../../contexts/AppRuntimeContext";
import { useOnboarding } from "../../onboarding/OnboardingManager";
import type { ThemeMode } from "../../lib/types";
import { hasUnseenChangelog } from "../../lib/changelog";
import { buildDocsUrl } from "../../lib/docs";
import { fallbackDesktopDownloadLinks, preferredDesktopDownloadLabel, preferredDesktopDownloadUrl } from "../../desktop/desktopDownloads";
import { AnnouncementsModal, getDismissedAnnouncementIds, type Announcement } from "../modals/AnnouncementsModal";
import { apiBaseUrl } from "../../lib/runtime";
import { SidebarAccountMenu } from "./SidebarAccountMenu";
import { SidebarHelpMenu } from "./SidebarHelpMenu";

interface SidebarFooterProps {
  themeMode: ThemeMode;
  setThemeMode: (mode: ThemeMode) => void;
  onLogout: () => void;
  onMobileClose: () => void;
}

export function SidebarFooter({ themeMode, setThemeMode, onLogout, onMobileClose }: SidebarFooterProps) {
  const [hasUnseen, setHasUnseen] = useState(() => hasUnseenChangelog());
  const [announcementsOpen, setAnnouncementsOpen] = useState(false);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [hasUnreadAnnouncements, setHasUnreadAnnouncements] = useState(false);
  const { user, activeWorkspaceId } = useWorkspaceApp();
  const { capabilities, activeServerProfile } = useAppRuntime();
  const { hasInProgressTutorial, isTutorialRunning, openTutorial, restartTutorial } = useOnboarding();
  const docsHomeUrl = buildDocsUrl("/");
  const tutorialActionLabel = hasInProgressTutorial ? "Resume Tutorial" : "Start Tutorial";
  const browserUserAgent = typeof navigator === "undefined" ? undefined : navigator.userAgent;
  const desktopDownloadLabel = preferredDesktopDownloadLabel(browserUserAgent);
  const desktopDownloadUrl = preferredDesktopDownloadUrl(fallbackDesktopDownloadLinks(), browserUserAgent);
  const hasHelpUnread = hasUnseen || hasUnreadAnnouncements;

  useEffect(() => {
    fetch(`${apiBaseUrl()}/api/announcements`)
      .then((r) => r.json())
      .then((data: { announcements: Announcement[] }) => {
        setAnnouncements(data.announcements);
        const dismissed = getDismissedAnnouncementIds();
        const unread = data.announcements.some((a) => a.notify && !dismissed.has(a.id));
        setHasUnreadAnnouncements(unread);
        if (unread) setAnnouncementsOpen(true);
      })
      .catch(() => {});
  }, []);

  return (
    <>
        <div className="sidebar-footer">
          <SidebarAccountMenu
            user={user}
            activeWorkspaceId={activeWorkspaceId}
            themeMode={themeMode}
            setThemeMode={setThemeMode}
            capabilities={capabilities}
            activeServerProfile={activeServerProfile}
            onLogout={onLogout}
            onMobileClose={onMobileClose}
          />
          <SidebarHelpMenu
            hasHelpUnread={hasHelpUnread}
            hasUnseen={hasUnseen}
            hasUnreadAnnouncements={hasUnreadAnnouncements}
            docsHomeUrl={docsHomeUrl}
            isTutorialRunning={isTutorialRunning}
            hasInProgressTutorial={hasInProgressTutorial}
            tutorialActionLabel={tutorialActionLabel}
            desktopDownloadUrl={desktopDownloadUrl}
            desktopDownloadLabel={desktopDownloadLabel}
            capabilities={capabilities}
            onSetHasUnseen={setHasUnseen}
            onOpenAnnouncements={() => {
              setAnnouncementsOpen(true);
              setHasUnreadAnnouncements(false);
            }}
            onOpenTutorial={openTutorial}
            onRestartTutorial={restartTutorial}
            onMobileClose={onMobileClose}
          />
        </div>
      {announcementsOpen && (
        <AnnouncementsModal
          announcements={announcements}
          onClose={() => setAnnouncementsOpen(false)}
        />
      )}
    </>
  );
}

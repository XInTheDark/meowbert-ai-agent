import type { NavigateFunction } from "react-router-dom";
import type { CommandPaletteAction } from "../../../components/navigation/CommandPalette";
import type { Project, TaskSummary, Workspace } from "../../../lib/types";
import { dispatchDesktopUploadRequest } from "./utils";

interface DesktopPlatform {
  showQuickAgent: () => Promise<void>;
}

interface ActiveServerProfile {
  mode: string;
  label: string;
  baseUrl: string;
}

interface BuildWorkspaceCommandPaletteActionsInput {
  activeWorkspaceId: string;
  activeProjectId: string | null;
  activeWorkspace: Workspace | undefined;
  activeProject: Project | undefined;
  tasks: TaskSummary[];
  userIsSuperAdmin: boolean;
  isDesktop: boolean;
  supportsRevealPath: boolean;
  supportsServerProfiles: boolean;
  activeServerProfile: ActiveServerProfile | null;
  navigate: NavigateFunction;
  onRevealCurrentFolder: () => Promise<void>;
  platform: DesktopPlatform;
}

export function buildWorkspaceCommandPaletteActions(
  input: BuildWorkspaceCommandPaletteActionsInput
): CommandPaletteAction[] {
  const actions: CommandPaletteAction[] = [];

  if (input.activeWorkspaceId) {
    actions.push(
      {
        id: "nav-all-projects",
        title: "All Projects",
        subtitle: input.activeWorkspace?.name ?? "Workspace",
        section: "Workspace",
        keywords: ["workspace", "overview", "home"],
        onSelect: () => input.navigate(`/app/${input.activeWorkspaceId}/projects`)
      },
      {
        id: "nav-workspace-files",
        title: "Files",
        subtitle: "Browse workspace files",
        section: "Workspace",
        keywords: ["workspace", "files", "upload", "download"],
        onSelect: () => input.navigate(`/app/${input.activeWorkspaceId}/files`)
      },
      {
        id: "nav-workspace-settings",
        title: "Workspace Settings",
        subtitle: "Memory, requests, and experiments",
        section: "Workspace",
        keywords: ["workspace", "settings", "memory", "requests"],
        onSelect: () => input.navigate(`/app/${input.activeWorkspaceId}/settings`)
      },
      {
        id: "nav-connectors",
        title: "Connectors",
        subtitle: "Workspace integrations",
        section: "Workspace",
        keywords: ["github", "discord", "telegram", "email"],
        onSelect: () => input.navigate(`/app/${input.activeWorkspaceId}/connectors`)
      },
      {
        id: "nav-notifications",
        title: "Notifications",
        subtitle: "Workspace notification center",
        section: "Workspace",
        keywords: ["alerts", "updates"],
        onSelect: () => input.navigate(`/app/${input.activeWorkspaceId}/notifications`)
      },
      {
        id: "nav-subscription",
        title: "Subscription",
        subtitle: "Usage and BYO settings",
        section: "Workspace",
        keywords: ["billing", "quota", "byo"],
        onSelect: () => input.navigate(`/app/${input.activeWorkspaceId}/subscription`)
      }
    );

    if (input.userIsSuperAdmin) {
      actions.push({
        id: "nav-admin",
        title: "Admin Panel",
        subtitle: "Global administration",
        section: "Workspace",
        keywords: ["admin", "users", "plans"],
        onSelect: () => input.navigate(`/app/${input.activeWorkspaceId}/admin`)
      });
    }
  }

  if (input.activeWorkspaceId && input.activeProjectId) {
    actions.push(
      {
        id: "env-new-task",
        title: "New Task",
        subtitle: input.activeProject?.name ?? "Project",
        section: "Project",
        keywords: ["compose", "prompt"],
        onSelect: () => input.navigate(`/app/${input.activeWorkspaceId}/projects/${input.activeProjectId}/tasks/new`)
      },
      {
        id: "env-overview",
        title: "Project Overview",
        subtitle: input.activeProject?.name ?? "Project",
        section: "Project",
        keywords: ["tasks", "overview"],
        onSelect: () => input.navigate(`/app/${input.activeWorkspaceId}/projects/${input.activeProjectId}`)
      },
      {
        id: "env-files",
        title: "Files",
        subtitle: "Browse current project files",
        section: "Project",
        keywords: ["filesystem", "upload", "download"],
        onSelect: () => input.navigate(`/app/${input.activeWorkspaceId}/projects/${input.activeProjectId}/files`)
      },
      {
        id: "env-context",
        title: "Project Context",
        subtitle: "Shared files auto-injected into tasks",
        section: "Project",
        keywords: ["context", "reference", "attachments", "files"],
        onSelect: () => input.navigate(`/app/${input.activeWorkspaceId}/projects/${input.activeProjectId}/context`)
      },
      {
        id: "env-settings",
        title: "Project Settings",
        subtitle: "Edit project settings",
        section: "Project",
        keywords: ["config", "settings"],
        onSelect: () => input.navigate(`/app/${input.activeWorkspaceId}/projects/${input.activeProjectId}/settings`)
      },
      {
        id: "env-upload",
        title: "Upload Files",
        subtitle: "Open native file picker in the current view",
        section: "Project",
        keywords: ["attach", "upload", "files"],
        onSelect: dispatchDesktopUploadRequest
      }
    );

    if (input.supportsRevealPath && input.activeServerProfile?.mode === "local" && input.activeProject?.root_path) {
      actions.push({
        id: "env-reveal-root",
        title: "Reveal Project Folder",
        subtitle: input.activeProject.root_path,
        section: "Project",
        keywords: ["finder", "explorer", "folder", "open"],
        onSelect: () => {
          void input.onRevealCurrentFolder();
        }
      });
    }
  }

  for (const task of input.tasks.slice(0, 8)) {
    if (!input.activeWorkspaceId || !input.activeProjectId) {
      break;
    }

    actions.push({
      id: `task-${task.id}`,
      title: task.title || "Untitled task",
      subtitle: `${task.status} · ${task.updated_at}`,
      section: "Recent Tasks",
      keywords: [task.status, task.task_type ?? "standard"],
      onSelect: () => input.navigate(`/app/${input.activeWorkspaceId}/projects/${input.activeProjectId}/tasks/${task.id}`)
    });
  }

  if (input.isDesktop) {
    actions.push(
      {
        id: "desktop-quick-agent",
        title: "Quick Agent",
        subtitle: "Open the floating composer",
        section: "Desktop",
        keywords: ["desktop", "quick", "shortcut", "composer"],
        onSelect: () => {
          void input.platform.showQuickAgent();
        }
      },
      {
        id: "desktop-preferences",
        title: "Desktop Preferences",
        subtitle: "Keyboard shortcuts and desktop-only settings",
        section: "Desktop",
        keywords: ["desktop", "shortcuts", "preferences", "settings"],
        onSelect: () => input.navigate("/desktop/preferences")
      }
    );
  }

  if (input.supportsServerProfiles) {
    actions.push({
      id: "desktop-servers",
      title: "Desktop Server Profiles",
      subtitle: input.activeServerProfile
        ? `${input.activeServerProfile.label} · ${input.activeServerProfile.baseUrl}`
        : "Choose a server",
      section: "Desktop",
      keywords: ["server", "local", "remote", "profiles"],
      onSelect: () => input.navigate("/servers")
    });
  }

  return actions;
}

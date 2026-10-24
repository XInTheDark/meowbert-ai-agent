---
title: Desktop App
summary: Use Quick Agent, desktop shortcut preferences, notifications, file dialogs, and local folder actions in Meowbert Desktop.
---

# Desktop App

Meowbert Desktop uses the same core product UI as the web app, with a few native integrations layered on top. This page shows where those desktop-only features live and how to use them.

<script setup lang="ts">
const releaseRepository = ((import.meta.env.VITE_DESKTOP_RELEASE_REPOSITORY as string | undefined) ?? "XInTheDark/meowbert-ai-agent").trim();
const releasesBaseUrl = `https://github.com/${releaseRepository}/releases`;
const releasesPageUrl = ((import.meta.env.VITE_DESKTOP_RELEASES_PAGE_URL as string | undefined) ?? "").trim() || releasesBaseUrl;
const macDownloadUrl = `${releasesBaseUrl}/latest/download/Meowbert-desktop-mac-universal.dmg`;
const windowsDownloadUrl = `${releasesBaseUrl}/latest/download/Meowbert-desktop-win-x64.exe`;
</script>

## Downloads

<ul>
  <li><a :href="macDownloadUrl">macOS universal DMG</a></li>
  <li><a :href="windowsDownloadUrl">Windows x64 installer</a></li>
  <li><a :href="releasesPageUrl">All desktop releases</a></li>
</ul>

> macOS downloads are currently unsigned preview builds. In-app auto-update is enabled on Windows first; macOS auto-update lands once signed and notarized releases are available.


## Switching servers

When you first open Meowbert Desktop, you'll see a welcome screen with two choices:

- **This computer** — connects to Meowbert running locally at `http://127.0.0.1:4000` (the standard Docker Compose setup).
- **Advanced** — lets you connect to a Meowbert server on another machine, or use a custom local port.

After setup, you can reopen server settings any time from either of these places:

- The **Server: ...** button near the bottom of the sidebar.
- The command palette action **Desktop Server Profiles**.

## Desktop preferences

Desktop-only settings live in **Desktop Preferences**.

You can open that page from:

- the **Desktop Preferences** button in the sidebar,
- the command palette action **Desktop Preferences**,
- the app menu item **View → Desktop Preferences**.

Right now, Desktop Preferences includes a dedicated **Keyboard Shortcuts** section where you can:

- change the global **Quick Agent** shortcut,
- change the in-app desktop shortcuts,
- clear a shortcut,
- reset everything back to the defaults.

## Keyboard shortcuts

These shortcuts are configurable in **Desktop Preferences**.

| Default shortcut | Action |
|---|---|
| `Cmd/Ctrl + Shift + Space` | Open **Quick Agent** from anywhere on your computer |
| `Cmd/Ctrl + K` | Open the command palette |
| `Cmd/Ctrl + N` | Start a new task in the current project |
| `Cmd/Ctrl + Shift + F` | Open the Files page for the current project |
| `Cmd/Ctrl + Shift + U` | Open the native file picker |
| `Cmd/Ctrl + Shift + O` | Open the current project folder in Finder / Explorer / your file manager |

## Quick Agent

**Quick Agent** is a floating desktop composer that can be opened even while you're in another app.

It uses the same task input UI as the normal composer, including:

- file attachments,
- tool toggles,
- skills,
- agent selection.

By default, Quick Agent sends the new task to your most recently used workspace and project. Inside the floating window, you can also switch the target workspace or project before sending.

After you submit, Meowbert Desktop jumps straight to the new task in the main window.

## Command palette

The command palette is still the quickest way to move around once Meowbert Desktop is focused. Open it with its configured shortcut, then search for actions like:

- **All Projects**
- **New Task**
- **Files**
- **Upload Files**
- **Reveal Project Folder**
- **Quick Agent**
- **Desktop Preferences**
- **Desktop Server Profiles**

## Window navigation

Use the app menu for window-level navigation:

- **View → Back**
- **View → Forward**
- **View → Reload**

Common shortcuts:

- macOS: `Cmd + [`, `Cmd + ]`, `Cmd + R`
- Windows / Linux: `Alt + Left`, `Alt + Right`, `Ctrl + R`

## Desktop notifications

Open **Notifications** in the sidebar, then enable desktop notifications.

Once enabled, Meowbert Desktop can show native notifications for:

- scheduled or recurring task updates,
- background task responses,
- task events that arrive while you're elsewhere in the app.

Clicking a notification brings the app to the front and opens the related task.

## Native file dialogs

Desktop file dialogs appear automatically in the places where you already work with files:

- **Task Composer / Task page / Quick Agent** — click the attachment button to pick files from your computer.
- **Files page** — click **Upload** to choose one or more files.
- **Downloads** — downloading a file or artifact opens a native save dialog instead of a browser download tab.

## Opening folders on your computer

If you're connected to a **local** Meowbert server running on the same machine, the desktop app can open folders directly in your file manager.

You can do that from:

- **Files → Open Folder**
- **Task page → More actions → Open Task Folder**
- your configured **Reveal Folder** shortcut
- the command palette action **Reveal Project Folder**

> **Note:** Folder reveal only works in local desktop mode. If you're connected to a hosted server, those files live on the server, not on your Mac or PC.

## Local tasks

When your server enables local execution, Meowbert Desktop can run standard tasks in Docker Desktop on an Apple Silicon Mac or Windows x64/arm64 computer. In **Desktop Preferences → Local Execution**, choose the server storage backend and its mounted folder, enable local execution, and keep Docker Desktop running with Linux containers. Then choose **Local** in the task composer. Cloud remains the default, and the web app does not offer the Local control.

The selected folder must be the same storage backend the server uses. For a server on another machine, your operator exports that storage over SMB or NFS and you mount it yourself. Meowbert checks the storage identity and tests read/write access from Docker before running tasks. Docker Desktop must be able to share the selected folder; a share that fails the probe cannot run local tasks.

On first use, the app asks before downloading the sandbox. It uses the server's pinned release and downloads updates automatically after consent. Keep the app open while tasks run; closing it stops their containers. Local tasks still use the server's model connection and budget.

If an uploaded input has not reached your mount yet, the task waits for storage and retries. Outputs show **Syncing** until the server verifies them; they become downloadable when ready. An output that does not arrive within 30 minutes is marked **Missing**.

Local tasks currently exclude host mode, host shell, Computer Use, your own Chrome, threads, schedules, subagents, Agent Swarm, Project Master, and Long Horizon workflows. Device-hosted workspaces and live Drive folders are not available yet.

## External browser handoff

A few flows still open in your system browser by design — for example, some connector auth flows such as GitHub installation. After you finish that flow in the browser, return to Meowbert Desktop and continue where you left off.

## Recommended everyday workflow

1. Open **Quick Agent** when you want to start something fast from anywhere.
2. Use the command palette to jump around once Meowbert Desktop is frontmost.
3. Customize the shortcuts you use most in **Desktop Preferences**.
4. Use the attachment button or your configured upload shortcut to add files.
5. Enable desktop notifications so you don't need to babysit long-running tasks.
6. Use **Open Folder** when you want to inspect local files outside the app.

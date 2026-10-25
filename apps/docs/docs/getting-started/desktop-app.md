---
title: Desktop App
summary: Connect to Meowbert and choose whether tasks run on the server or your computer.
---

# Desktop App

## Overview

Meowbert Desktop is a Mac and Windows app for your Meowbert server. You sign into the same account and use the same workspaces, Projects and task conversations as in the browser.

The app can also execute tasks on your computer. **Connecting to a server and choosing where a task runs are separate decisions:** opening the desktop app does not automatically make tasks local.

| What you want to do | Guide |
| --- | --- |
| Understand what Local changes | [Local tasks](./desktop-app/local-tasks) |
| Run an existing server workspace on your computer | [Use a server workspace locally](./desktop-app/server-workspaces) |
| Keep a new workspace's files on this computer | [Workspaces on this device](./desktop-app/device-workspaces) |
| Allow commands, screen control or browser access on your computer | [Host mode and host tools](./desktop-app/host-tools) |
| Use attached Google Drive folders in a local task | [Live Google Drive folders](./desktop-app/live-drive-folders) |
| Open Quick Agent or customize keyboard shortcuts | [Quick Agent and shortcuts](./desktop-app/shortcuts) |

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

Choosing **This computer** connects to a server already running on your computer. It does not install a server or select Local for every task. Choosing a remote server does not prevent local execution, but a server-hosted workspace needs shared storage for a local task.

## Local tasks

The server keeps the conversation and calls the model. For a local task, your computer executes the commands. A task can use an existing server workspace if your computer can access its storage, or a separate workspace whose files live on your device.

Start with the [Local tasks overview](./desktop-app/local-tasks), then follow [Use a server workspace locally](./desktop-app/server-workspaces) or [Workspaces on this device](./desktop-app/device-workspaces).

### Workspaces on this device

Choose **On this device** when creating a new workspace to keep its files in a folder on your computer. Its tasks always target that computer. This does not convert an existing server workspace. See the [device workspace guide](./desktop-app/device-workspaces).

### Live Google Drive folders

On macOS, local Host tasks can use attached Drive folders with explicit connection consent. This is separate from sharing a server workspace's storage. See the [Drive folder guide](./desktop-app/live-drive-folders).

## Desktop preferences

Open **account menu → Desktop Preferences**, use the command palette action **Desktop Preferences**, or choose **View → Desktop Preferences** in the app menu.

- **Local Execution** sets storage, task capacity, Sandbox or Host mode, and optional host tools.
- **Computer Use** manages screen-control permissions.
- **Shortcuts** customizes global and in-app keyboard shortcuts.

## Quick Agent

Open the floating composer from another app with **Cmd/Ctrl + Shift + Space**. It starts a task in your selected workspace and Project. See [Quick Agent and shortcuts](./desktop-app/shortcuts).

## Keyboard shortcuts

Use **Desktop Preferences → Shortcuts** to change or clear bindings. The [shortcut reference](./desktop-app/shortcuts#keyboard-shortcuts) lists the defaults.

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

## External browser handoff

A few flows still open in your system browser by design — for example, some connector auth flows such as GitHub installation. After you finish that flow in the browser, return to Meowbert Desktop and continue where you left off.

---
title: Files Browser
summary: Upload, preview, download, and open files in your project workspace.
onboardingId: files-browser
checklistLabel: Files browser
---

# Files Browser

The Files browser gives you direct access to the project's filesystem — the same directory where tasks read and write files. Use it to upload source data before running a task, inspect generated outputs, or download results to your local machine.

## Navigating the filesystem

- **Single-click** a file to select it.
- **Double-click** a folder to open it and show its contents.
- Use the **breadcrumb trail** at the top to navigate back up to a parent directory.
- The current path is always shown so you know where you are.

If Workspace Memory is enabled, you'll also see a `.memory` folder when browsing workspace-level files. That folder stores durable notes the agent can keep updating across tasks. See [Workspace Memory](/core-workflows/workspace-memory) for the full workflow.

## Uploading files

1. Navigate to the directory where you want the file to live.
2. Click the **Upload** button (or drag files onto the browser panel).
3. Select one or more files from your local machine.

Uploaded files are immediately available to tasks running in this project. Reference them in your prompt by their path relative to the project root, for example: `data/sales_2025.csv`.

On Meowbert Desktop, **Upload** opens the native file picker.

## Previewing files

Select a text file (e.g., `.txt`, `.csv`, `.md`, `.json`, `.py`) to see a preview of its contents in the right panel. This is useful for quickly inspecting output without downloading.

Binary files (images, PDFs, DOCX, etc.) show a placeholder — download them to view locally.

## Working with live sync files and folders

Google Drive, OneDrive, pCloud, and rclone files or folders attached in **Live sync** mode still appear here as normal project items, but they stay linked to the original remote item.

Google Drive **folders** stream ordinary files when opened and upload edits automatically. Native Google Docs, Sheets, and Slides appear as `.url` links: the agent can read or edit them with the Google Workspace skill, or export an Office copy on demand. No full-folder download is required, and manual Pull/Push does not apply to these mounted folders.

Individual live-linked files and folders from other providers use working copies:

- Live-linked files and folders show a **Live** badge in the file list.
- Select one linked item to see its sync status in the preview pane.
- Use **Pull** to replace the local working copy with the latest remote version.
- Use **Push** to upload the current local working copy back to the remote source. For linked folders, push can create new remote files/folders and remove remote children that were deleted locally.
- If both sides changed since the last sync, the item shows **Conflict** so you can decide whether to use a force action intentionally.
- **Open in Google Drive** or **Open in OneDrive** jumps straight to the remote item in your browser when the provider exposes a web link. pCloud and rclone links do not expose a generic web-open action.
- **Unlink** stops future syncing but keeps the local item in the project.

Working copies use manual sync. Google Drive folder mounts and direct Google Workspace editing use the automatic behavior described above.

## Downloading files

Right-click a file and choose **Download**, or select it and click the download button. This saves a copy to your local machine without affecting the server-side file.

On Meowbert Desktop, downloads open a native save dialog instead of a browser download tab.

## Opening folders locally

If you're connected to a **local** Meowbert server in the desktop app, click **Open Folder** to reveal the current project directory in Finder, Explorer, or your file manager.

This option is only available in local desktop mode. Hosted servers keep files on the remote machine, so there is no matching local folder to open.

## Creating and deleting files

Use the context menu (right-click or the `⋮` menu) for per-file actions:
- **Delete** — permanently removes the file from the project.
- **Rename** — rename the file in place.

> **Tip:** For a large batch of file changes, describe the changes in a task.

## Relationship to tasks

Every task gets its own working subdirectory (under the project root) where it writes output files. Files written by a task are visible here after the task completes. The project root directory is also accessible — you can pre-populate it with shared reference files that any task can read.

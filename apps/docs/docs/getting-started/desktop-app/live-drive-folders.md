---
title: Live Google Drive folders
summary: Attach Drive folders for a macOS Host task without making a working copy.
---

# Live Google Drive folders

## Overview

A live Drive folder lets a local Host task read and edit an attached Google Drive folder as files are needed. Edits upload automatically; this differs from importing a one-off copy into the task.

It is a **folder attachment**, not a way to synchronize an entire server workspace. A local task in a server workspace still needs [access to that workspace's storage](./server-workspaces). A device workspace needs only its own local folder.

This feature requires **macOS, Host mode and the user who connected the workspace's Google Drive account**. Windows and local Sandbox mode do not support these mounts.

## Attach a folder

1. Enable **Live Google Drive folders** in **Desktop Preferences → Local Execution** and save.
2. Connect Google Drive in your workspace and choose **Host** for the task.
3. Attach a Drive folder in **Live sync** mode to the task or Project Context.
4. Accept the connection-specific permission prompt before the folder mounts.

Folders mount while local tasks use them and unmount after the last task finishes. In device workspaces, Files and Project Context show the linked folder; browse its contents in Google Drive or ask a local Host task to use it.

## Understand the permission

The first mount asks permission to store a credential with access to your **entire Google Drive**, even when you attach just one folder. Choosing a folder does not narrow that credential's access.

Approval is remembered for that device, server and connection. Reconnecting the Google account asks again. Only the person who connected the account can mount its folders locally.

## Unlink a folder or revoke access

Removing a folder link from Files unlinks it without deleting the remote files. Ending a task, disabling live folders or removing a device cleans up the app's local credentials, but cannot revoke a copy someone kept.

To revoke every copy, **disconnect Google Drive in Meowbert** or remove Meowbert's access from your Google account. If disconnecting fails, retry until it succeeds.

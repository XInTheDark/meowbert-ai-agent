---
title: Workspaces on this device
summary: Create a workspace whose files stay in a folder on your computer.
---

# Workspaces on this device

## Overview

A device workspace stores its files in a folder you choose on your computer. Every task in it targets that computer, so you do not need a share of the server's storage or a Cloud/Local selector.

This creates a **new workspace**. It does not move an existing server workspace. To run a task locally while keeping an existing server workspace, use [Use a server workspace locally](./server-workspaces) instead.

The server still stores conversations and task settings and handles the model connection. File content read by the agent goes to the model through the server. Files living on your computer does not mean the task is offline or that its contents never leave the device.

## Create the workspace

Your server operator must first enable [local execution](/self-hosting/local-execution). Then:

1. Open the workspace dropdown and choose **New**, or open **Manage Workspaces**.
2. Enter a workspace name, change **On server** to **On this device**, and click **Create**.
3. Choose a dedicated folder and confirm creation. Meowbert records that workspace's folder and enables local execution for it.
4. Open **Desktop Preferences → Local Execution**. Choose Sandbox or enable **Allow host mode**, then save your preferences. You do not need a server storage backend ID or shared storage root for this workspace.
5. Create a Project and a task. The task automatically targets this computer; choose **Sandbox** or **Host** in the composer.

Sandbox needs Docker Desktop and the separate sandbox download. Host needs consent to run directly as you. See [Local tasks](./local-tasks#choose-how-local-commands-run) for the difference.

## Where you can use the files

Use Files, Project Context, uploads, downloads and memory files in the desktop app on the owning device. Other devices and the web app can show conversations, but file views direct you to the owning device.

Schedules and recurring runs also target this device and wait while it is unavailable. Keep the desktop app open and the computer awake for local work.

## Available features

Device workspaces are single-user. Live Google Drive folders work on macOS in Host mode. Other linked-source file sync, canvases, Project terminals, server memory search and automatic memory refresh are unavailable. You can still browse and use the memory files on the device.

## Relink or delete a workspace

After reinstalling the app or moving the folder to another computer, use **Relink** in Manage Workspaces and select the existing folder. Its workspace marker must match. Meowbert revokes the old device's execution ownership before resuming tasks on the new device.

Deleting a workspace never deletes its chosen folder. Task and Project cleanup reaches offline devices when they reconnect.

---
title: Host mode and host tools
summary: Understand direct execution and optional access to your shell screen and browser.
---

# Host mode and host tools

## Overview

**Host** and **Sandbox** describe where a task's regular commands run. **Host shell**, **Computer Use** and **Your Chrome** are separate permissions for actions on your computer.

For example, a Sandbox task can do most work inside Docker and use an explicitly enabled host tool for a step that needs your computer. Choosing Host runs the task's regular commands directly on your computer instead.

| Choice | What it permits |
| --- | --- |
| **Host mode** | Run a local task's commands directly as your user account, without Docker |
| **Host shell** | Run host commands outside the sandbox when that tool is enabled |
| **Computer Use** | Take screenshots, move the pointer, click, type and use your desktop applications |
| **Your Chrome** | Use a separate persistent Meowbert browser profile on your computer |

Host mode and Host shell can run any command as you and read or change any of your files. They require explicit consent. These permissions are independent of whether the workspace files live on the server or this device.

## Allow Host mode

In **account menu → Desktop Preferences → Local Execution**, enable **Allow host mode** and save. Confirm the prompt explaining access to your computer. Set **Default mode** to Host if you want it for new local tasks, or choose Host beside Local in the task composer.

Host does not require Docker. It uses only host-supported bundled skills and does not install missing runtime tools. A server workspace still needs the shared storage described in [Use a server workspace locally](./server-workspaces).

## Optional host tools

In **Desktop Preferences → Local Execution**, enable only the tools you want the task to use:

- **Host shell** requires the same host-execution consent as Host mode.
- **Computer Use** requires system permissions for screen control. Manage them in **Desktop Preferences → Computer Use**. See [Computer Use](/core-workflows/computer-use) for task controls.
- **Your Chrome** opens Chrome, or Edge when Chrome is unavailable, with a separate Meowbert profile. Sign into sites in that window to keep those logins between tasks.

Your Chrome does not reuse your everyday browser profile. Computer Use and the persistent browser each have one task owner at a time. Keep the desktop app open while local work runs; closing it stops local commands and containers.

## Live Google Drive folders

Live Drive folders work in both Sandbox and Host mode on macOS. Enabling either mode alone does not grant Drive access. See [Live Google Drive folders](./live-drive-folders) for connection-specific permission and revocation.

---
title: Project Overview
summary: Track task status, filter history, and launch new work from one screen.
onboardingId: project-overview
checklistLabel: Project overview
---

# Project Overview

The Project Overview page is your task control center. It shows every task that has run (or is running) in the current project and gives you tools to filter, inspect, and act on them.

## Reading the task list

Tasks can be organized into shared folders. Folders only affect how the Project Overview is arranged; each task remains its own task, with the same files, conversation, status, schedule, and runtime behavior.

Each row in the task list shows:

- **Status badge** — the current state of the task (`running`, `queued`, `awaiting_input`, `done`, `cancelled`, `error`, etc.).
- **Prompt snippet** — the first line of the original prompt, so you can identify tasks at a glance.
- **Timestamps** — when the task was created and last updated.
- **Task type** — `standard` (one-shot), `scheduled` (recurring), or `infinite` (long-running loop).

Click any row to open the full Task Detail view for that task.

## Organizing tasks into folders

Use **New folder** to create folders in the current project. Folders can contain tasks and subfolders, so you can group related runs by feature, incident, client, release, or any structure your team uses.

To move tasks:

1. Select one or more task rows.
2. Open **Actions** and choose **Move selected**.
3. Choose a folder, or choose the project root to move tasks out of folders.

You can also use a task row's action menu to move a single task, or drag a task row onto a folder. Moving a task is cosmetic only: it does not restart the task, move task files, change schedules, or affect task history.

Folder actions are available from each folder row. You can rename a folder, create a subfolder, move the folder elsewhere in the tree, or delete it. Deleting a folder moves its tasks and subfolders up one level instead of deleting the tasks.

## Filtering the task list

Use the filter controls above the list to narrow down what you see:

| Filter | Options |
|---|---|
| **Status** | `running`, `queued`, `awaiting_input`, `done`, `cancelled`, `error` |
| **Type** | `standard`, `scheduled`, `infinite` |
| **Scope** | `active` (non-trashed), `trash`, `all` |
| **Folder** | all tasks, unfiled tasks, or one folder subtree |
| **Search** | Free-text search against the prompt content |

Combining filters is useful when you have many tasks — for example, filtering to `running + infinite` to see all active long-running loops.

When search or filters match tasks inside folders, the overview keeps the containing folders visible so you can see where the matching tasks live. Selecting a specific folder searches and filters only that folder and its subfolders.

## Bulk actions

When you need to cancel or clean up multiple tasks at once:

1. Use the **Select page** checkbox to select all visible tasks.
2. Choose a bulk action (e.g., **Cancel selected**).

This is particularly useful when a batch of queued tasks needs to be cleared before re-queuing.

## Canvases

The **Canvases** section lists persistent Interactive Canvases for the current project.

Each canvas is a project-level website that Meowbert can keep editing across tasks. Use **Open** to inspect the live preview, or **Continue** to start a new canvas-backed task.

See [Interactive Canvas](/core-workflows/interactive-canvas) for the full workflow.

## Starting a new task

Click **New Task** in the sidebar (or a button at the top of the overview) to open the Task Composer for this project. See [Task Composer](/core-workflows/task-composer) for a full guide.

Incognito chats are intentionally excluded from the task list and task search. Open them directly from the chat page while they exist, or delete them permanently from the task toolbar.

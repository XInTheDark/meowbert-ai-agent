---
title: Open Your Project
summary: Every new workspace starts with a project. Open it, rename it if needed, and create more later.
onboardingId: create-project
checklistLabel: Open project
---

# Open Your Project

Every new workspace starts with a ready-to-use project, so you can begin immediately without any setup step. That project is where tasks run, files live, and shell sessions attach.

## Step 1 — Open the project list

In the sidebar, click **All Projects**. Your default project should already be listed there.

## Step 2 — Open the default project

Click anywhere on the project card to open it. You land in a conversation with the project's **Master**, who starts and follows up on tasks for you (see [Project Master](/getting-started/project-master)). Confirm that:

- You can message the Master right away.
- **All tasks** and **New Task** are available if you would rather manage tasks yourself.
- **Files**, **Context**, **Canvases**, and **Settings** are available in the project tabs.

If the project shows `error`, check the server logs or contact your server admin.

## Step 3 — Rename it if you want

If the default name is too generic, open the **⋯** menu on the project card, choose **Rename**, and type a clearer name in place, for example:

- `production-api`
- `data-analysis`
- `sandbox`

Good names help both teammates and connector routing pick the right project later.

## Step 4 — Create more projects when you need them

You can create more projects from the **All Projects** page whenever you want separate runtimes for different apps, environments, or experiments. Type a name in the box at the top of the page and click **Create**.

## Optional setup

Once you open the project, you can also configure:

- **Personality** in **Settings**. See [Agents & Personalities](/core-workflows/agents-and-personalities).
- **Sandbox networking** in **Settings** for projects that need package installs, API calls, or web access.
- **Memory** in **Workspace Settings** if you want shared long-term notes. See [Workspace Memory](/core-workflows/workspace-memory).
- **Default Context** in **Settings** for shared background instructions that should be prepended to every task.

## Tips

- A workspace can have many projects, but most people only need one to get started.
- Archive projects you are no longer using to keep the list tidy. **Archive** is in the card's **⋯** menu, and archived projects can be restored from the same menu.
- Projects do not keep always-on containers running. Meowbert starts sandbox containers only while a task run or terminal session is active.

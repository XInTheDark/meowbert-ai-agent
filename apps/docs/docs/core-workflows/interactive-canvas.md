---
title: Interactive Canvas
summary: Build and refine persistent project websites with Meowbert.
onboardingId: interactive-canvas
checklistLabel: Interactive Canvas
---

# Interactive Canvas

Interactive Canvas is a project workspace for learning, experiments, visual tools, and other work that is easier to do in a live page than in a linear chat.

A canvas is a real website stored in your project. Meowbert edits its files, you preview the page directly, and the conversation stays available in a compact side panel.

## When to use it

Use Interactive Canvas when you want Meowbert to build or refine something you can inspect and interact with:

- a learning playground,
- a simulation or visual explanation,
- a small local app,
- an experiment dashboard,
- a design or UI prototype,
- or any project-specific website that should persist across tasks.

For one-off documents, slides, and rendered visual artifacts, the **Canvas** skill may still be a better fit. Interactive Canvas is for a project-level website you want to keep working on.

## Start a canvas

1. Open a project.
2. Click **New Task**.
3. Open **Tools** and turn on **Interactive Canvas**.
4. Describe what you want Meowbert to build.
5. Send the task.

Turning on Interactive Canvas does not create a blank canvas by itself. It gives Meowbert the canvas tool and the right project-level instructions. When Meowbert decides the task needs a canvas, it creates one, writes the real website files, and then the task opens in the canvas view.

## Canvas view

The canvas view has two main areas:

- **Preview** — the live website fills the main page.
- **Task sidebar** — the active or latest task for that canvas stays beside the preview.

The top bar shows the canvas name, runtime mode, refresh control, file shortcut, and dev-server controls when the canvas uses a dev server.

On mobile, the preview and chat are separate tabs, with preview shown first.

## Continue an existing canvas

From the Project Overview, use the **Canvases** section to open an existing canvas.

You can also open the attachment menu in a task or follow-up composer and choose **Canvases**. Selecting a canvas can attach it as context, and **Canvas mode** continues work against that canvas.

## Files and persistence

Canvas files live in the project, not inside a single task run. That means future tasks can keep editing the same canvas.

Each canvas has:

- a source folder under the project,
- an entry file, usually `index.html`,
- and a `canvas.json` manifest with title, entry file, runtime mode, and dev-server settings when needed.

Use the **Files** button in the canvas top bar to inspect or edit the canvas files directly.

## Runtime modes

Most canvases start in **Static** mode. Static mode is fast and works well for plain HTML, CSS, and JavaScript.

If a canvas needs a local framework dev server, it can use **Dev server** mode. In that mode, Meowbert runs the configured development command for the canvas and the preview is proxied through Meowbert.

## In-page Meowbert actions

Canvas pages can include buttons that ask Meowbert to keep working. For example, a page might have a **Check my answer** button or an **Improve this view** action.

Those actions do not receive backend credentials. They ask the parent Meowbert app to create a normal project task attached to the current canvas, so task history, billing, permissions, and follow-up behavior stay the same as any other task.

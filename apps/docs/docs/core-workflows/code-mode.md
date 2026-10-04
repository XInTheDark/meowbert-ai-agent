---
title: Code Mode
summary: Meowbert runs several tool calls from one short script, so long tasks take fewer model turns and fewer tokens.
---

# Code Mode

In code mode, Meowbert can chain several steps into one short script instead of spending a model turn on each tool call. It might list a folder, read the files it needs, and run a command on them, then look only at the parts of the output that matter.

On long tasks this means fewer model turns and less output in the conversation, which cuts token use. Code mode is on by default in every workspace.

## What you see

Each script shows up as one step in the task's Activity card. Meowbert can describe a step in one short line, such as "Checking which tests fail". The card lists the last few steps, and the step that's still running shimmers. Open the Activity card to see each script and the tool calls it ran.

Images and PDFs that Meowbert opens during a script are still shown to it once the script finishes, so it can look at screenshots, charts, and documents the same way as before.

## What stays the same

Some actions always happen on their own, outside any script:

- Delivering the final response, waiting, and stopping a task.
- Turning on skills.
- Editing files with patches.
- Managing the task's context.
- Computer use.

## Turn code mode off

Workspace owners can turn it off for a workspace:

1. Open **Workspace Settings**.
2. In the **Experiments** tab, turn off **Code mode**.
3. Save your changes.

A running turn keeps the setting it started with.

---
title: Task Composer
summary: Write prompts, attach files, and enable tools before sending a task.
onboardingId: task-composer
checklistLabel: Task composer
---

# Task Composer

The Task Composer is where you define a new task. A well-constructed task gets better results — this page explains every option available.

## Writing an effective prompt

Your prompt is the agent's instruction set. Structure it like this:

1. **State the desired output first.** For example: _"Generate a CSV summary of monthly sales by region."_
2. **Add constraints.** Format requirements, file names, style guides, deadlines.
3. **Provide context.** If the agent needs to know about your stack, business logic, or prior decisions, include a brief description or attach a reference file.
4. **Be specific about scope.** Ambiguity leads to the agent making assumptions. Spell out what's in and what's out.

**Example of a vague prompt:**
> _"Analyze the data."_

**Example of a strong prompt:**
> _"Read `data/sales_2025.csv`, calculate total revenue per region for Q1, and write the result to `output/q1_summary.csv`. Use Python with pandas. Skip rows where `region` is blank."_

## Selecting an agent

Below the prompt field, you can choose an **agent preset**. Agents control the reasoning effort and model used for the task:

| Agent | Best for |
|---|---|
| **Default** | Most tasks — balanced speed and quality. |
| **Deep Think** | Complex problems requiring deeper reasoning (slower, higher effort). |
| **Fast** | Quick tasks where speed matters more than thoroughness. |

If you're unsure, leave it on **Default**. See [Agents & Personalities](/core-workflows/agents-and-personalities) for more detail.

Some presets may be visible only to super-admin accounts, depending on how your platform is configured.

## Choosing a workflow

Open the **task parameters** menu to choose the task workflow before sending it.

### Standard task

This is the default for most work. Use it when one agent run is enough.

### Long Horizon

Choose **Long Horizon** when you want the agent to:

- clarify first,
- write a durable plan,
- execute against that plan,
- and pass a reviewer panel before the task is allowed to finish.

This is ideal for larger tasks where you do not want the model to stop after a shallow partial answer.

### Deep Research

Choose **Deep Research** when you need a careful, source-aware answer. It follows the Long Horizon clarify, plan, execute, and review flow, but is designed to investigate both deeply and broadly as the question requires.

For example, it can follow official documentation and PDFs closely for a specific program, or compare official information with independent reporting and user experience when the real-world picture may differ. It asks concise questions when the research goal or expected deliverable is unclear, keeps meaningful progress updates during the work, and by default gives a concise conclusion first with the sources it actually used at the end.

Turn on **Web Search** in Tools when you want current web research. The task can also use any other tools, Skills, or Sources you select.

### Quality control (Experimental)

Choose **Quality control** when the final wording, structure, formatting, or visual design needs dedicated review before delivery.

Quality control follows the same clarify, plan, execute, and review flow as Long Horizon. Its reviewer focuses on the human experience of the result: whether the reply is intuitive and well organized, whether text artifacts read naturally, and whether presentations, documents, images, and other visual files are clean and polished.

If the reviewer finds a problem, the task revises the result and submits it again before finishing.

### Agent Swarm

Choose **Agent Swarm** when you want multiple agents to collaborate through shared chat channels before a final answer is delivered.

You can set the **worker count** from **2 to 16**. A leader is added automatically.

This works well when:

- you want parallel investigation,
- you want different perspectives,
- or you want agents to challenge each other instead of relying on a single chain of thought.

See [Long Horizon, Deep Research, Quality control & Agent Swarm](/core-workflows/task-workflows) for the full breakdown.

## Incognito chat

Use **Incognito chat** when you want a short-lived task that should not appear in project task lists or task search.

Incognito chats behave like normal standard tasks while they are open, but they are intentionally temporary:

- They do not appear in the project task list.
- They do not appear in workspace or project task search.
- They are automatically deleted after 24 hours.
- You can delete them permanently from the Task Detail toolbar.

Incognito chat is available for standard tasks. It is not used for scheduled tasks, Long Horizon, Deep Research, Quality control, Agent Swarm, or Interactive Canvas tasks.

## Attaching files

Click the **attachment icon** to upload files into the task. These are placed in the task's working directory so the agent can reference them directly. Use this for:

- Source data files (CSV, JSON, logs).
- Reference documents the agent should read.
- Templates or existing files to be modified.

If your workspace has a connected file **Source** such as Google Drive, OneDrive, pCloud, or rclone, the same attach menu also lets you bring files in directly from that source.

The attach menu can also list project **Canvases**. Attach a canvas when the task should reference an existing interactive website, or choose **Canvas mode** when you want the next task to continue editing that canvas.

For **Google Drive**, **OneDrive**, **pCloud**, and **rclone**, the picker can offer two modes:

- **Copy** — import a one-off local copy into the task's `inputs/` folder.
- **Live sync** — create a local working copy in `inputs/`, but keep it linked to the same remote file or folder so you can pull newer remote changes or push your finished edits back later from the Files browser.

The **Live sync** option appears only when the workspace's source connection has write access. In Live sync mode, folders can be linked too; pushing a linked folder can create new remote files/folders and remove remote children that were deleted locally. When a live-sync item is attached, Meowbert keeps the agent aware that it is working on a linked source path rather than a detached copy. For native Google Docs, Sheets, and Slides, Meowbert uses an exported Office file as the local working copy and asks for confirmation before creating the live-sync link. pCloud and rclone search match file and folder names/paths.

### Attaching Google Docs, Sheets, and Slides

When a Google Drive selection includes a native Google Doc, Sheet, or Slides presentation, Meowbert asks how to attach it:

- **Convert to Office files** — Recommended and selected by default. Creates DOCX, XLSX, or PPTX files that use the existing Copy or Live sync workflow.
- **Attach Google files directly** — Experimental. Adds a reference to the original Google file and lets the agent read and edit that shared file immediately.

Direct attachments modify the original Google file rather than a local working copy. They are available only when the connected Google Drive account has write access, and they do not use Live sync Pull or Push controls because changes are applied directly.

Choosing direct attachment adds that Google file to the Project's Google Workspace allowlist. The file is then available to Google Workspace tools in every task in that Project, including when it was originally attached from a task rather than Project Context. Connecting Google Drive alone does not authorize every file in the account, and copying a `.gdoc`, `.gsheet`, or `.gslides` pointer into another Project does not grant access there. For a mixed selection, this choice applies only to native Google Workspace files; other files keep the selected Copy or Live sync mode.

If your admins have enabled **YouTube**, the attach menu also lets you paste a video link. In that case, Meowbert attaches a compact metadata summary for the video instead of downloading the media itself.

File size limits apply per upload. For large datasets, consider uploading to the project first (via Files browser) and referencing the path in your prompt.

## Tool toggles

Click the **wrench icon** to expand the tool options panel. These toggles enable additional capabilities for the task:

| Toggle | What it enables |
|---|---|
| **Web Search** | The agent can fetch current information from the web during the task. |
| **Memory** | The agent can semantically search the workspace's persistent `.memory` directory during the task. This toggle appears only when Memory is enabled for the workspace. |
| **Schedule Tasks** | Enables recurring/scheduled execution. A schedule picker appears in the prompt area. |
| **Subtasks** | The agent can delegate scoped sub-tasks to child tasks, useful for large multi-step workflows. |
| **Skills** | Enables workspace-defined Skills (MCP tool packs). A skill selector appears to choose which skill to activate. |

Sources are selected from the separate **Sources** button next to **Tools**.

When you enable a source there, the agent can use source-specific tools during the run — for example, searching Google Drive, pCloud, or rclone, fetching a Drive, OneDrive, pCloud, or rclone file into the task filesystem, searching Outlook emails, viewing calendars, safely managing Outlook events, or using `yt-dlp` workflows for YouTube links and metadata.

Outlook is a tool-only source rather than a file-import source. That means it does not appear in the **Attach files** picker, but it does let the agent work against the connected mailbox and calendars during the run.

If the task also includes live-synced source files, the agent gets dedicated sync actions for those linked task files so it can check status, pull the latest remote version, or push finished local edits back safely.

When a workspace has Memory enabled, new task drafts start with **Memory** turned on by default, but you can disable it for any specific run.

These tool selections also carry into workflow runs. For example, if you start an Agent Swarm with Web Search and Memory enabled, the swarm agents receive those same selected capabilities.

Workspace owners connect sources from **Connectors → Sources**. Server admins can configure the provider settings by following [Sources (Admin Setup)](/reference/sources-admin-setup).

See [Tool Options Reference](/reference/tool-options) for details on each option and [Skills](/reference/skills) for the available skill packs.

## Interactive Canvas tool

Turn on **Interactive Canvas** when the task should create or update a live project website instead of only replying in chat.

When enabled, Meowbert gets the Interactive Canvas tool and canvas-specific instructions. A new canvas is created only if Meowbert explicitly uses that tool during the task. Existing canvases can still be selected from the attachment menu when you want to continue one directly.

Interactive Canvas tasks use the project filesystem and do not run in Quick mode.

See [Interactive Canvas](/core-workflows/interactive-canvas) for how to open, continue, and interact with canvases.

## Submitting the task

Click **Send** (or press `Ctrl+Enter` / `Cmd+Enter`) to queue the task. You'll be taken to the Task Detail view where you can watch the agent work in real time via the events stream.

From there, you can also open **sidebar threads** on assistant replies when you want to ask a focused follow-up without interrupting the main conversation. See [Task Follow-up](/core-workflows/task-follow-up) for the full thread workflow.

If you prefer a different message shortcut, open **Preferences** from the sidebar. You can switch between the default **Enter to send** behavior and **Shift+Enter to send**.

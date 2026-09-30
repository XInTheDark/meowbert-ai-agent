---
title: Welcome to Meowbert
summary: Get oriented quickly, then work through the most common workflows.
onboardingId: welcome
checklistLabel: Welcome
---

# Welcome to Meowbert

Meowbert lets you run AI agents that execute real shell commands inside sandboxed workspace projects. Think of it as a team-aware platform where you describe outcomes in plain language and the agent does the work — writing files, running scripts, calling APIs, and reporting back.

## The three-tier model

Everything in Meowbert is organized in three layers:

### 1. Workspace
A workspace is the top-level container for your team or project. It holds:
- **Members** — the people who have access.
- **Connectors** — integrations with Telegram, Discord, and GitHub so tasks can be triggered externally.
- **Notifications** — browser push alerts for task completions and events.
- **Memory** — if enabled, a shared `.memory` directory and `MEMORY.md` that persist across all projects in the workspace.
- **Subscription & limits** — concurrency and usage caps.

You can belong to multiple workspaces and switch between them freely.

### 2. Project
A project is a runtime area — a directory on the server where files live and shell sessions run. Each project has its own:
- **Root directory** — files written by tasks or uploaded by you persist here.
- **Shell sessions** — you can open a live terminal attached to this directory.
- **Settings** — personality, default context, sandbox network policy, and task concurrency limits.
- **Task history** — all tasks that ran in this project.

A workspace can have many projects. Common patterns are one per project, one per deployment target (e.g., `staging`, `production`), or one per team member.

### 3. Task
A task is a single AI conversation. When you submit a prompt, the agent:
1. Reads the conversation history.
2. Calls the configured model.
3. Executes any shell commands the model emits.
4. Records output as events.
5. Loops until the task is complete or you cancel it.

Task runs and terminal sessions use short-lived Docker sandbox containers. Meowbert does not keep one container per project running all the time, so idle projects stay lightweight.

Tasks keep their full message history, so you can follow up, branch to alternatives, or inspect exactly what happened.

## Quick path to your first task

1. Open the left sidebar and choose your workspace.
2. Open the default project, or create another one if you need a separate runtime.
3. Click **New Task** and describe what you want done.
4. Watch the events stream as the agent works.
5. Follow up with clarifications or corrections in the same conversation.

## What these docs cover

- [Workspace Navigation](/getting-started/workspace-navigation) — moving around the UI.
- [Open Your Project](/getting-started/create-project) — getting into the default runtime and creating more later.
- [Task Composer](/core-workflows/task-composer) — writing effective prompts and enabling tools.
- [Workspace Memory](/core-workflows/workspace-memory) — storing durable notes the agent can reuse across tasks.
- [Task Follow-up](/core-workflows/task-follow-up) — steering and inspecting agent runs.
- [Agents & Personalities](/core-workflows/agents-and-personalities) — controlling reasoning effort and tone.
- [Context Compaction](/core-workflows/context-compaction) — how long conversations are managed.
- [Connectors](/core-workflows/connectors) — triggering tasks from Telegram, Discord, and GitHub.
- [Files Browser](/core-workflows/files-browser) — working with task output files.
- [Agent shell sessions](/core-workflows/agent-shells) — inspect and stop background commands.
- [Skills](/reference/skills) — MCP-based tool extensions.

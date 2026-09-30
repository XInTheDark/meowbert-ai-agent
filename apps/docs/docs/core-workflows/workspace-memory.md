---
title: Workspace Memory
summary: Keep durable notes in the workspace so agents remember your preferences, conventions, and decisions across tasks.
onboardingId: workspace-memory
checklistLabel: Memory
---

# Workspace Memory

Workspace Memory gives each workspace a persistent `.memory` directory for long-lived notes. Use it for stable facts, recurring preferences, project conventions, decision logs, and reference material that should still matter in later tasks.

Memory is enabled by default for new workspaces. Workspace owners can disable it when a workspace should not keep persistent notes.

## Enable Memory

1. Open the workspace.
2. Go to **Workspace Settings**.
3. In the **Memory** tab, turn on **Enable Memory** if it is currently off.
4. Save your changes.

Once enabled, Meowbert creates a `.memory` folder at the workspace root. That folder is shared across projects in the same workspace and stays available for future tasks and shell sessions.

## What belongs in `.memory`

Good fits for Memory include:

- Project-specific facts the agent keeps needing.
- Stable preferences such as coding conventions or output formats.
- Reusable references, glossaries, and decision notes.
- Short summaries of previous discoveries that will matter again later.

Avoid treating `.memory` like throwaway scratch space. Temporary task artifacts usually belong in normal task output files instead.

## MEMORY.md — your always-on context

Inside `.memory` there's a special file: `MEMORY.md`. Unlike other notes, this file is automatically injected into every run as background context, so the agent always has it available without needing to search for it.

Think of `MEMORY.md` as the front page of your memory — a compact, high-value summary that's always present. Good things to keep here:

- A short overview of the project or workspace.
- Key commands, workflows, and tooling preferences.
- Coding conventions and output format preferences.
- Active decisions and open questions.
- Links or pointers to more detailed notes elsewhere in `.memory`.

Avoid letting `MEMORY.md` grow too long. Put detailed notes in other files under `.memory` and reference or summarize them from `MEMORY.md` instead. The file is trimmed if it gets too large, so keep it focused on what matters most.



When Memory is enabled for a workspace:

- The task composer, quick agent, and follow-up input can show a **Memory** toggle in the tools menu.
- New task drafts in that workspace start with **Memory** enabled by default.
- You can still turn it off for any individual task.

With the toggle on, the agent can semantically search workspace `.memory` during the run. Search results include relevant snippets plus the source file path and line range, so the agent can open or update the right note instead of guessing.

Meowbert syncs the Memory index in the background. Searches use the last ready index immediately instead of blocking on rebuilds. If the workspace is still being indexed for the first time, Memory search can briefly return no results while indexing finishes.

See [Tool Options](/reference/tool-options) for the per-task toggle behavior.

## Refreshing Memory

The workspace sidebar includes a **Memory** page. It previews the workspace `MEMORY.md` and the active Project `MEMORY.md`, and its **Open in Files** action opens the `.memory` directory in the Files browser.

Workspace owners can enable **Automatic Memory Refresh** in **Workspace Settings → Memory**. Meowbert evaluates new activity using the amount of conversation, completed work, and time since the last refresh, then queues bounded refresh tasks only when the accumulated context is likely to be useful. Automatic refreshes are spaced at least three hours apart for each Project.

Each Project can opt out from **Project Settings → Memory**. Projects are enabled by default, but their automatic refresh setting only takes effect while the workspace-wide automatic-refresh setting remains enabled.

You can also select a Project and choose **Refresh memory** from the Memory page. A refresh creates a regular task with its own sandbox. It receives the new conversation evidence in `inputs/memory-delta.md`, can update the workspace and Project Memory files, and is limited to 20 agent steps. It uses the normal task execution and platform usage accounting path.

Set the Agent Preset for refresh tasks in **Admin → Models → Specialized runtime** with `memorySynthesisAgent`. Its full preset payload, including model and reasoning configuration, is applied and resolved through the normal model-routing path. If it is unset or unavailable, Meowbert uses the default available Agent Preset.

## Working with Memory from Files and Tasks

The `.memory` folder is part of the normal workspace filesystem:

- Open it from the workspace [Files Browser](/core-workflows/files-browser).
- Ask a task to update a memory file in that workspace.
- Reference it directly in prompts with paths like `.memory/preferences.md`.

When Memory is enabled, task runs and agent shell sessions also receive these environment variables:

- `MEMORY_DIR`
- `MEOWBERT_MEMORY_DIR`

Both point to the workspace `.memory` directory.

## Self-hosted embedding configuration

If you self-host Meowbert, you can choose the embeddings provider and model used for Memory indexing in `config/global.json`:

By default, Memory uses the connection selected in **Admin → AI providers**. Set `baseUrl` and `apiKey` below only when Memory needs a separate embeddings provider. Switching the default provider causes Memory to rebuild its index on the next sync or search.

```json
{
  "memory": {
    "embeddings": {
      "mode": "openai",
      "model": "text-embedding-3-small",
      "baseUrl": "https://api.openai.com/v1",
      "apiKey": "REPLACE_WITH_API_KEY"
    }
  }
}
```

Supported `mode` values are:

- `openai`
- `ollama`
- `sentence-transformers`
- `mlx`

Additional provider fields are available when needed:

- `baseUrl` and `apiKey` for OpenAI-compatible providers.
- `host` for Ollama.
- `buildPromptTemplate` and `queryPromptTemplate` for embedding setups that need prompt prefixes.

Changing the Memory embedding settings triggers a background reindex. Existing searches keep using the last ready index until the new one is ready.

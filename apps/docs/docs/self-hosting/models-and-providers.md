---
title: Models & Providers
summary: Connect a model provider, choose which models people can use, and set the background models.
---

# Models & Providers

## Overview

A **provider** is the service Meowbert calls for AI responses. A **model** is the model ID that service offers. An **agent preset** is a user-facing choice in the composer that combines a model with defaults such as reasoning effort.

For example, connect a provider once, then offer a Fast preset and a Deep Think preset using models available through it. Users choose the preset when creating a task; background jobs can have separate model settings.

| You want to change… | Configure… |
| --- | --- |
| Which service receives model requests | The provider's base URL and credentials |
| Which model and defaults people can select | Agent presets |
| Models used for routing, titles or memory | Background models and embeddings |
| A user's own provider instead of the server's | [Bring Your Own Provider](/core-workflows/byo-providers) |

These settings choose the AI connection, not the machine executing commands. A task running locally on a desktop still calls its model through the server.


## Providers

Meowbert calls models through the **OpenAI Responses API**. A provider is just a base URL and an API key, for example:

| Provider | Base URL |
| --- | --- |
| OpenAI | `https://api.openai.com/v1` |
| An API gateway or proxy | Its OpenAI-compatible base URL, if it supports `/v1/responses` |
| A local model server | For example `http://192.168.1.20:8000/v1`, if it supports the Responses API. Use an address the containers can reach, not `localhost` |

The setup wizard adds your first provider. Later, manage providers in **Admin Panel → AI providers**. You can save several and switch between them. The selected provider is used for all platform model calls.

::: warning Chat Completions-only servers
Providers that only implement `/v1/chat/completions` don't work yet. Check that your provider or local server supports `/v1/responses`.
:::

## Models people can choose

The composer's model choices are **agent presets**: a model ID plus defaults such as reasoning effort. Open **Admin Panel → Model → Agent presets** to configure them. See [Agent presets](./agent-presets) for JSON examples and field definitions.

### Agent Swarm presets

A swarm preset adds a leader, optional model router, delegation effort, budgets and lane limits. These defaults also appear in the task composer. The [Agent Swarm preset reference](./agent-presets#agent-swarm-presets) explains how the settings interact.

## Background models

**Admin Panel → Model → Specialized runtime** sets the models Meowbert uses behind the scenes:

| Setting | Used for | If unset |
| --- | --- | --- |
| `internalModel` | Routing connector messages to the right project, and as the fallback task model | `openai.defaultModel` from the config file |
| `fastModel` | Task titles, summarizing long conversations, and other quick jobs inside a task | The task's own model |
| `reviewerAgent` | The reviewer in Quality control tasks (a preset ID) | Built-in default |
| `memorySynthesisAgent` | Memory refresh tasks (a preset ID) | Built-in default |
| `subagentFastAgent` | Fast subagents (a preset ID) | Not available |

A small, fast model is a good choice for `internalModel` and `fastModel`.

## Memory embeddings

[Workspace Memory](/core-workflows/workspace-memory) search uses an embedding model. Set it in **Admin Panel → Platform → Embeddings**:

- **Provider** — Follow the selected AI provider, or pin one of your saved providers. It must support the OpenAI-compatible `/v1/embeddings` endpoint.
- **Model** — The embedding model ID. Defaults to `text-embedding-3-small`.
- **Prompt templates** — Only for models that expect a prefix, such as `search_query: {text}`. Leave them empty otherwise.

Saving these settings never re-embeds Memory, so you can switch providers that serve the same model without rebuilding anything. After changing the model or templates, the tab shows that the indexes are out of date, and search quality drops until you re-embed. If the new model returns a different vector size, Memory search stops working until you do:

- **On next use** marks every index for rebuilding. Each workspace re-embeds the next time it's used, and its first Memory search waits for that.
- **Wipe & re-index** rebuilds every workspace now. Choose how many to rebuild at once, then follow the progress on the same page. You can cancel it, and one interrupted by a worker restart picks up again on its own.

If a provider serves different weights under the same model name, re-embed after switching to it.

::: tip Upgrading
Embedding settings are no longer read from `config/global.json`. If you had a `memory.embeddings` block there, set the same provider and model in the Embeddings tab, then remove the block.
:::

## Context windows and model details

Meowbert needs to know each model's context window to decide when to compact long conversations. Add entries in **Admin Panel → Model → Model metadata**. See [Context Compaction](/core-workflows/context-compaction).

[Code mode](/core-workflows/code-mode) is on for every model by default. If a model handles it poorly, add `"code_mode": false` to that model's entry, or to the `default` entry to turn it off for all models. A workspace only uses code mode when both the model and the workspace allow it.

## Letting users bring their own provider

Users can connect their own API key or, experimentally, a ChatGPT subscription in their settings. Their tasks then use their provider instead of yours. See [Bring Your Own Provider](/core-workflows/byo-providers).

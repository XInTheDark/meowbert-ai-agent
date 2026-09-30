---
title: Agents & Personalities
summary: Control reasoning effort with agent presets and set per-project tone with personalities.
---

# Agents & Personalities

Meowbert gives you two independent knobs to shape how the AI agent behaves: **Agents** control the model and reasoning effort, and **Personalities** control the tone and communication style.

---

## Agents

An **agent preset** defines which model runs the task and how much reasoning effort it applies. You select an agent in the Task Composer before submitting a task.

### Built-in agent presets

| Preset | Reasoning effort | Best for |
|---|---|---|
| **Default** | High | Most tasks — balanced quality and speed. This is the safe choice when unsure. |
| **Deep Think** | Extra-high (`xhigh`) | Hard problems: complex architectures, multi-step analyses, subtle bugs. Slower but more thorough. |
| **Fast** | Low | Quick tasks: simple transformations, short summaries, fast iterations. Highest throughput. |

### How to select an agent

1. Open the **Task Composer** (click **New Task** in the sidebar).
2. Look for the **Agent** selector — it appears below or alongside the prompt input.
3. Click it to open the dropdown and choose a preset.
4. The selected preset is remembered as a draft for this project, so you don't need to re-select it each time.

If no agent is explicitly selected, the **Default** preset is used.

### Agent presets and the model

Each preset carries a model identifier and reasoning parameters in its payload. By default all built-in presets use the same underlying model but differ in reasoning effort. Server admins can configure custom presets with different models entirely — for example, a cost-optimized preset on a smaller model or a premium preset on a frontier model.

### Admin-level customization

Server admins can define custom agent presets from the **Admin → Agent Presets** panel. Each preset requires:

- **ID** — unique lowercase identifier (used internally and saved in drafts).
- **Name** — display name shown in the selector.
- **Description** — short explanation of when to use this preset.
- **requiresSuperAdmin** — optional boolean; when `true`, only super-admin accounts can see and select the preset.
- **Payload** — JSON object specifying at minimum `model` plus a nested `responses` object for provider-facing request settings such as `reasoning.effort`.

Example custom preset payload:
```json
[
  {
    "id": "premium-review",
    "name": "Premium review",
    "description": "Stronger model for critical reviews.",
    "requiresSuperAdmin": true,
    "payload": {
      "model": "gpt-4.1",
      "responses": {
        "reasoning": {
          "effort": "medium"
        }
      }
    }
  }
]
```

Changes to presets take effect immediately for new tasks. Existing running tasks continue using the preset they were started with.

---

## Personalities

A **personality** is a tone and communication style profile applied to every task in a project. While agents affect *how much* the model thinks, personalities affect *how it speaks*.

### Available personalities

| ID | Label | Description |
|---|---|---|
| `default` | Default | Warm, direct, and candid. Good general-purpose tone. |
| `none` | None | No personality injection — the model uses its own defaults entirely. |
| `concise` | Concise | Fewest words possible. Short bullets, compact structure, no extra context unless asked. |
| `friendly` | Friendly | Warm, conversational, encouraging. Includes helpful transitions and extra practical tips. |
| `cold` | Cold | Emotionally neutral and clinical. Precise, impersonal, fact-first. No small talk. |
| `aggressive` | Aggressive | Blunt and confrontational. Challenges weak reasoning directly. Low hedge. |

### How to set a personality for a project

1. Open the project in the sidebar.
2. Click **Settings**.
3. Find the **Personality** dropdown.
4. Select the desired personality.
5. Save.

The personality takes effect on the **next task run** in that project. It has no effect on tasks that are already running.

### How personalities work

When a task starts, the worker reads the project's personality setting and injects the corresponding prompt text at the beginning of the agent's system prompt. For example, choosing **Concise** prepends:

> _"Be concise and direct. Use the fewest words needed to deliver a complete and correct answer. Prefer short bullets and compact structure over long prose."_

Choosing **None** injects nothing, letting the model speak in its own default voice.

### Choosing the right personality

- For automated pipelines (connectors, scheduled tasks): **Concise** or **Cold** reduce response bloat.
- For interactive use with non-technical team members: **Friendly** makes outputs easier to read.
- For thorough technical analysis: **Default** or **Cold** keep responses focused.
- For experimentation or testing model behavior: **Aggressive**, **Liberal**, or **Donald Trump** are useful contrast cases.

### Custom personalities

Personalities are defined as `.md` files in the `prompt-texts/personality/` directory. Each file name (without the extension) becomes a personality ID. To add a custom personality:

1. Create a new file, e.g., `prompt-texts/personality/terse.md`.
2. Write the instruction text that should be injected into the system prompt.
3. Restart the API and worker processes for the new personality to be loaded.

The personality will then appear in the Project Settings dropdown automatically.

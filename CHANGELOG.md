# Changelog

## Oct 4, 2026

### AI and agents

- **Step summaries in code mode** — While Meowbert works in code mode, it can describe each step in one short line. The Activity card now lists the last few steps, and the step that's still running shimmers so you can follow along without opening each tool call.

## Oct 3, 2026

### AI and agents

- **Code mode (experimental)** — Meowbert can run several tool calls from one short script instead of spending a model turn on each, which can cut token use on long tasks. Workspace owners can turn it on under **Workspace Settings → Experiments**. Admins can turn it off for specific models with `"code_mode": false` in the model metadata.

## Oct 2, 2026

### Files and projects

- **Redesigned project cards** — Click anywhere on a project to open it. Rename, Files, Settings, and Archive now sit in a menu on each card, and renaming happens in place.
- **Storage limits apply to uploads** — Once a workspace reaches its storage limit, uploads, new text files, and files copied in from connected sources are refused with a clear message.
- **Large uploads** — Files over the 100 MB upload limit are now rejected instead of being saved cut short.

### Security

- **Artifacts stay sandboxed in new tabs** — Canvases and inline artifacts opened in their own tab now run in the same sandbox as they do inside the app.

## Sep 30, 2026

### Meowbert is open source

- **First public release** — Meowbert is now open source under the AGPL-3.0 license. Run it on your own server with Docker Compose, connect any model provider that supports the OpenAI Responses API, and keep all your work on your own hardware. See the **Quickstart** in the docs to get started.
- **Admin setup wizard** — New servers walk the first admin through connecting a model provider, choosing models, picking background models, and deciding who can sign up.
- **Agent Swarm** — Multi-model workflows, previously called Model Council, are now Agent Swarm.
- **Guided tour** — The in-app tour is split into short sections you can skip, and now covers memory, scheduled tasks, workflows, the canvas, and shell sessions.

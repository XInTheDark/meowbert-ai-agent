# Changelog

## Oct 14, 2026

### AI and agents

- **Reasoning in step order** — In the Activity panel, the agent's reasoning now appears as short lines between the tool calls it led to, instead of one block at the top. Click a line to read it in full.
- **Tidier Agent Swarm answers** — Once a swarm delivers its final answer, the work leading up to it folds into one **Worked for…** row. Files and error notices stay visible, and you can open the row to see everything.
- **Choose the model for the Master's tasks** — The Project Master chat has a second **Task model** picker for the tasks the Master starts. Pick a model, an Agent Swarm, or a router. With a router, the Master picks one of the router's models for each task itself. Tasks the Master follows up on keep the model they started with.
- **Master updates reach the right person** — When several people share a project, each task report goes back to whoever asked the Master for that work, in the chat they last wrote from.
- **Your own follow-ups stay yours** — If you message a task the Master started, that run is no longer reported back to the Master unless it's been asked to follow the task.
- **Accurate task reports** — A report now only quotes the run it's about, so a run that ended without a reply no longer repeats an earlier answer.
- **Project Master setting moved** — Turn the Master on or off under **Workspace Settings → Agent**.

### Speed

- **Faster app loading** — The app downloads about half as much up front. Other pages, math rendering, and code highlighting load in the background or when first needed.
- **Faster conversations** — Opening the Project Master starts loading its messages straight away, and long conversations open and page much faster.

### Self-hosting

- **Router targets name their model directly** — Each router option now sets its model in a top-level `"model"` field, and `"payload"` is optional. Saved routers are converted when you run `npm run migrate`.
- **Router reasoning effort is opt-in** — Routers no longer set reasoning effort unless `"allowReasoningEffort": true` is set on the router, so each option's own setting applies by default.

## Oct 4, 2026

### AI and agents

- **Code mode is on by default** — Every workspace now uses code mode unless a workspace owner turns it off under **Workspace Settings → Experiments**. Images and PDFs that Meowbert opens during a script are now shown to it, so it can view them without leaving code mode. See **Code Mode** in the docs.
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

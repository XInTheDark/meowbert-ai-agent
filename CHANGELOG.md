# Changelog

## Oct 29, 2026

### Tasks

- **See where a task is at a glance** — On longer tasks, agents now share a short goal and the steps they plan, and update them as the work changes. The activity card shows the goal, a progress bar, each step as done, in progress or still to come, and what the agent is doing right now under the active step.
- **Artifacts on the activity card** — Files an agent marks as artifacts during a turn now appear on the activity card. The card is also larger and easier to read, and step summaries stay visible after you reload the page.

## Oct 28, 2026

### Memory

- **Agents remember what they've read** — With Memory on, agents can save a detailed summary of a file, a folder or a group of related files as they read them, and check those summaries in later tasks instead of rereading. Each summary notes how its files looked when read, so an agent can tell when one has changed and update it. Summaries are ordinary Memory files, so Memory search finds them and you can edit them. Mostly used for Project Context, but any file in the workspace can be indexed.
- **More detailed Memory notes** — Agents keep `MEMORY.md` short but now write fuller topic files, with a focus on keeping out notes a later task wouldn't use rather than on keeping files brief.
- **Faster task starts with large Project Context** — Tasks now read only the top level of the context folder, plus paths you've added notes to, instead of every file inside it. Memory search also stops re-reading unchanged Memory files after each task.

## Oct 27, 2026

### Canvas

- **Point to what you want changed** — Use **Select an element** in the canvas panel, click a heading, button, image, or section, and send your request with its context. Press **Esc** to return to normal interaction.
- **More focused design iterations** — Canvas guidance now keeps variation labels stable, explores deliberate differences, and uses selected-element context to find the right source while preserving unrelated content and styling.

## Oct 25, 2026

### Local execution

- **Run tasks on your own computer** — Meowbert Desktop now offers **Cloud** or **Local** when starting a task. Local tasks run in Docker Desktop on Apple Silicon Macs and Windows x64/arm64, with the same conversation, progress and results in Meowbert. Model connections, usage and budgets stay managed by your server.
- **Use your desktop tools** — Choose **Host** to run commands directly as your desktop user, with explicit permission and full access to your files. Optional **Host shell**, **Computer Use** and **Your Chrome** let tasks use local commands, control your screen and keep browser logins in a separate Meowbert profile.
- **Keep a workspace on one device** — Create an **On this device** workspace in a folder you choose, with Files, Project Context, uploads, downloads and memory files handled by that computer. These workspaces are single-user; conversations remain on the server. Relink an existing folder after reinstalling or moving devices, and deleting the workspace leaves the folder intact.
- **Wait safely for devices and shared storage** — Server-hosted workspaces can use the same storage mounted on your computer, including SMB or NFS shares. Tasks wait when the device or required files are unavailable, and outputs show **Syncing** until the server verifies them. Scheduled and recurring local tasks wait for their device too.
- **Work with live Google Drive folders on Mac** — Local Host tasks can mount linked Drive folders while they need them, stream files on demand and upload edits automatically. Only the person who connected the account can approve access. Consent covers the entire Drive, even for one linked folder; disconnecting Google Drive revokes that access. Removing a folder link leaves its Drive contents intact.
- **Local starts with standard tasks** — Threads, subagents, Agent Swarm, Project Master and Long Horizon workflows remain unavailable locally. Live Drive folders currently require macOS Host mode.

### Self-hosting

- **Local execution is off by default** — Update both the server and desktop app, run `npm run migrate`, and enable local execution in server configuration before setting it up in Desktop Preferences. The sandbox image now supports both Intel/AMD and Arm devices; publish the updated image with **Publish Sandbox Runtime**, and update any pinned image reference. See **Desktop App** and **Configuration** in the docs for setup and supported storage arrangements.

## Oct 24, 2026

### AI and agents

- **Agent Swarm has been rebuilt around lanes** — Swarms can now split work into persistent lanes, fork context, park and resume work, leave notes, and coordinate through explicit diverge, check, steer, and stop actions. A model router can choose models per lane, while the swarm shares its budget across the leader and workers. The composer, lane tracks, task view, admin editor, and docs all support the new workflow.
- **Swarms keep their settings and stop cleanly** — Task runs now preserve the swarm settings they were created with, enforce lane and depth limits throughout the lifecycle, and keep progressing when a worker disappears or reaches its limit.
- **Choose how aggressively a swarm spawns work** — The new **Effort** profile in the task composer and Agent Swarm presets ranges from **Minimal** to **Maximum**, tuning lane fan-out, depth, and recon nudges while leaving budgets and concurrency limits intact. **Balanced** keeps the normal defaults.
- **More reliable swarm turns** — Swarms can use their full configured output budget, read the latest channel messages, and report turns that finish without a tool call.

### Threads and outlines

- **Start a thread from the work already in front of you** — Messages and task outline items can now open a focused thread, and an empty outline can generate its first outline directly.
- **Threads keep your place** — Opening the thread panel no longer jumps the conversation or loses the reading position.

### Mobile

- **A native-feeling mobile layout** — The main app, admin panel, canvases, context pages, and forms now adapt to phone-sized screens with mobile navigation and touch-friendly controls. Typing on mobile is smoother too.

### Connected sources

- **Search linked Google Drive folders** — Live-sync can search folder contents by text, with parallel and cached traversal, configurable depth, and clearer handling of larger folder trees.

### Operations and polish

- **Find wasted agent turns** — Admins now have a debug view for investigating turns that consumed work without producing a useful result.
- **Sidebar and menus behave better** — Desktop navigation stays out of the way until needed, menus flip below their trigger when space is tight, and the sidebar toggle no longer distorts or overlaps the page.
- **Pinned Node.js base images** — Docker builds now use Node.js 22.23.4 consistently.
- **Warm code-mode tools are documented correctly** — The worker tells the model which tools are already available instead of making it discover them through an exec step.

## Oct 18, 2026

### Canvas

- **One Canvas** — Interactive Canvas and the Canvas skill are now one feature, turned on with **Canvas** in **Tools**. Tasks and workspace defaults that used Interactive Canvas switch over on their own. See **Canvas** in the docs.
- **No more blank boxes** — Canvases that save progress, use forms, or load scripts as modules now work in the app instead of showing a white screen. When a page does fail, the canvas shows the error with **Retry** and a **Fix** button that sends the errors to Meowbert.
- **Checked before you see it** — Meowbert opens every page it shows you in a browser under the same conditions as your view, and fixes errors, missing files, and blank pages before replying.
- **Inline or beside the chat** — Small visuals sit inside the reply, sized to their content and matched to your light or dark theme. Pages, apps, and decks open in a resizable panel next to the conversation, with full, tablet, and phone widths. Open views reload when Meowbert changes them.
- **Project canvases open with their task** — Opening a project canvas shows it beside its latest task, with the full conversation, instead of a separate page with its own chat. Tasks no longer jump away to the canvas while Meowbert is still building it.
- **Safer page buttons** — When a canvas asks Meowbert for more work, it shows exactly what it wants to send, and nothing is sent until you click **Send**.
- **Frameworks build to static pages** — Canvases no longer run dev servers. Meowbert builds framework projects to plain HTML and shows the built page.

### Self-hosting

- **Canvas migration** — Run `npm run migrate`. It removes the dev-server settings from project canvases, which are now always served as static files. A canvas that relied on a dev server needs a build: ask Meowbert to build it and show the result.
- **Republish the sandbox image** — The sandbox runtime image now includes the canvas page runtime that Meowbert's page check uses. The **Publish Sandbox Runtime** workflow runs on `main` for this change; if you pin `MEOWBERT_SANDBOX_RUNTIME_IMAGE`, update it.
- **Leftover dev-server containers are removed** — The API's sandbox cleanup now stops any canvas dev-server containers left from earlier versions.

## Oct 17, 2026

### AI and agents

- **Agent Swarm shares one budget** — The leader and its workers now spend from one shared token budget, so workers no longer stop partway through while the leader forgets to give them more. When the budget runs low, every agent is told to report and wrap up, and once it is spent the leader delivers with what the workers found instead of waiting on them. See **Task Workflows** in the docs.
- **Swarm usage adds up** — **Task usage** now counts the tokens of every agent a task brings in, such as swarm workers and subagents, with one **Spawned agents** row in the run table.
- **Fast scratch space for repos and builds** — Each task now has a local scratch folder for work that creates lots of small files, such as cloning git repositories, installing dependencies, and building code. Clones that used to time out on network-mounted storage now finish in seconds. Normal files still go in the task's folder. Scratch isn't shown in the Files browser and is cleared when the task is deleted or archived. See **Files Browser** in the docs.

### Self-hosting

- **Swarm budget migration** — Run `npm run migrate`. It returns any unused per-worker swarm budget to its swarm's shared budget, so swarms that are already running carry on under the new model.
- **Task scratch storage** — Scratch folders live under `runtime.taskScratch.root`, which defaults to `task-scratch` next to `tasksRoot` (`/srv/meowbert/runtime/task-scratch` on the host). Keep it on local disk. Add `runtime.taskScratch.xfsProjectQuota` to cap each workspace's scratch at its storage limit on an XFS mount. See **Configuration** in the docs.
- **XFS quotas work inside containers** — Meowbert now creates the XFS device node a container needs for `xfs_quota`, so XFS project quotas no longer fail with "No such device or address" when only the mount is passed in.

## Oct 16, 2026

### AI and agents

- **Better Memory search** — Memory search now matches exact words, such as command names, error codes, and long IDs or hashes, as well as meaning, and knows which section of a note each result comes from. Each workspace's Memory index rebuilds once after updating.
- **Tidier Memory** — Meowbert keeps Memory as named topic files linked from `MEMORY.md`, and Memory refreshes reorganize notes that have become cluttered. A refresh can now take up to 40 steps.
- **Refreshes no longer skip messages** — When a long stretch of conversation doesn't fit in one Memory refresh, the rest is now picked up by the next one instead of being dropped.

### Self-hosting

- **Embeddings in the Admin Panel** — Choose the Memory embedding provider and model under **Admin Panel → Platform → Embeddings**. `memory.embeddings` in `config/global.json` is no longer read: set the same values in the new tab, then remove the block. Run `npm run migrate` to add the new settings. See **Models & Providers** in the docs.
- **Re-embed Memory when you choose** — Saving embedding settings never re-embeds Memory, so switching providers for the same model costs nothing. After changing the model or templates, the Embeddings tab shows the indexes are out of date: re-embed each workspace on its next use, or wipe and re-index everything now with live progress and a choice of how many workspaces run at once.
- **Grouped admin navigation** — The Admin Panel's sections now sit in three menus: Operations, Platform, and Channels.
- **Admins can open any task** — Admins can now open any workspace, project, or task by link without being a member. Settings reserved for workspace owners still need an owner.
- **Recent memory refreshes** — **Admin Panel → Operations → Processes** lists the latest Memory refreshes, with a link to each refresh task.

## Oct 15, 2026

### Speed

- **Snappier on slow connections** — Most requests now take one round trip instead of two, and the app's code stays cached between visits, so pages open noticeably faster when the server is far away.
- **Messages appear as you send them** — Your message shows in the conversation and the input clears the moment you press send. If sending fails, your text comes back.
- **Faster task opening** — Opening a running task no longer waits on a second request to show its latest tool calls, and the app goes straight to your last workspace.
- **Faster run start** — Tasks in projects connected to GitHub start sooner.

### Self-hosting

- **The web app serves the API** — The web container now runs Caddy and passes `/api` through to the API, so the web address is all browsers need. `VITE_API_URL` is now optional: remove it and rebuild the web image to get the faster setup, or keep it to call a separate API address. `VITE_ALLOWED_HOSTS` is no longer used by the web container. See **Configuration** in the docs.

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

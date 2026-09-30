---
title: Common Issues
---

# Common Issues

This page covers the most frequent problems users encounter and how to resolve them.

---

## No project selected

**Symptom:** Clicking New Task or Files shows an error or does nothing.

**Fix:** You need to open a project first.
1. Click **All Projects** in the sidebar.
2. Select an existing project, or create one if none exist.
3. Now retry your action.

---

## Task appears stuck in `running`

**Symptom:** A task has been in `running` state for an unusually long time without updating.

**Steps to diagnose:**
1. Open the task in Task Detail.
2. Click the **Events** tab.
3. Scroll to the bottom — look at the most recent event. Is it a shell command that's running? Is it a model call waiting for a response?
4. If the last event is old and nothing is updating, the task may be genuinely stuck.

**Fixes:**
- **For a stuck shell command:** The command may be waiting for input or hung. Click **Cancel** to abort the task, then refine your prompt to avoid the problematic command (e.g., add a timeout or avoid interactive commands).
- **For a stuck model call:** Check your OpenAI API status and key validity. If the API is healthy, the task may have hit the model request timeout. Cancel and retry.
- **For a task that just seems slow:** Long tasks (especially with web search or heavy reasoning) can take several minutes. Check the last event timestamp before concluding it's stuck.

---

## Notifications not appearing

**Symptom:** You enabled notifications but aren't receiving browser alerts.

**Checklist:**
1. Go to **Notifications** in the sidebar and verify the toggle is **Enabled**.
2. Check your browser's notification permissions for this site. Look for a bell or lock icon in the URL bar.
3. If you clicked "Block" earlier, reset the permission: in most browsers, go to `Settings → Privacy & Security → Site Permissions → Notifications` and remove the block for this domain.
4. Verify you're in the correct **workspace** — notifications are workspace-scoped.
5. Make sure the browser tab is not muted or in a focus/do-not-disturb mode.

---

## Connector messages not creating tasks

**Symptom:** You send a message via Telegram, Discord, GitHub, or Email but no task is created.

**Checklist:**
1. **Verify pairing (Telegram/Discord):** Your account must be paired to a workspace member. Go to Connectors → the relevant tab and check your pairing status.
2. **Verify default project:** If no routing rule matches, messages go to the default project. If no default is set, the message is dropped. Set a default project in the connector settings.
3. **Check connector status:** The connector tab should show a green "Connected" status. A red or warning status means the bot token is invalid or the gateway is disconnected.
4. **For GitHub:** Confirm the comment mentions the app's bot login (`@your-app-slug` or `@your-app-slug[bot]`). Comments without a mention are ignored. Also verify the App is installed on that repository.
5. **For Email:** Confirm server admin setup is complete (inbound domain, webhook token, Brevo API key), workspace email connector is connected, and sender policy allows your sender address.
6. **Check routing rules:** If you have routing rules configured, verify one matches your message. Try sending a message that matches the default rule first to confirm basic connectivity.

---

## GitHub connector tab not visible

**Symptom:** The GitHub tab doesn't appear in the Connectors page.

**Fix:** The GitHub connector is disabled by default. Add `"github": { "enabled": true }` to your `config/global.json` and restart the API service.

---

## Context window errors

**Symptom:** A task fails with a context length or token limit error.

**What's happening:** The conversation history grew too large for the model to process.

**Fix:**
- Context compaction should handle this automatically. If it didn't, it may have been on cooldown after a previous error.
- Check the task's Events tab for a compaction event. If none occurred, the fast model may be misconfigured.
- Verify the **fast model** in **Admin → Models → Specialized models** is valid for your provider.
- If the task is critical, cancel it and start fresh with a more focused prompt that provides only the essential context.

See [Context Compaction](/core-workflows/context-compaction) for more detail.

---

## Project shows `error` status

**Symptom:** A project has `error` status and tasks won't run.

**Fixes:**
- Check the API and worker logs for errors related to this project's root path.
- Verify the project's root directory exists on the server filesystem and is writable.
- Try updating the project status back to `active` in **Project Settings** if the underlying issue has been resolved.

---

## Scheduled tasks not running

**Symptom:** A scheduled task has a schedule configured but isn't running at the expected times.

**Checklist:**
1. Verify the task status is `scheduled` (not `cancelled` or `done`).
2. Check the worker service is running — scheduled tasks are processed by the worker.
3. Verify the schedule expression is correct. An incorrectly formatted cron expression may never fire.
4. Check your workspace's recurring task limits — if you've hit the maximum, new scheduled runs may be queued or dropped.

---

## Can't log in / JWT errors

**Symptom:** Login fails or you're immediately logged out.

**Fixes:**
- Verify `security.jwtSecret` is set in your config and hasn't changed since you last logged in (changing the secret invalidates all existing sessions).
- Check that the API service is running and reachable.
- Clear browser cookies/localStorage for this domain and try again.

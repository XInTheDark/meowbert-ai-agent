---
title: Task Follow-up
summary: Continue a conversation, branch edits, and review assistant/tool output.
onboardingId: task-follow-up
checklistLabel: Task follow-ups
---

# Task Follow-up

After a task starts, the **Task Detail** view is where you steer the work, review what the agent did, and continue the conversation.

## The events stream

The events stream (the main area of Task Detail) shows everything that happened during the task in chronological order:

- **User messages** — your original prompt and any follow-ups.
- **Assistant messages** — the agent's responses, reasoning, and plans.
- **Tool calls** — every shell command the agent ran, including the full command text.
- **Tool output** — the output (stdout/stderr) from each command.
- **Context compaction events** — when the conversation was summarized to save context space (see [Context Compaction](/core-workflows/context-compaction)).
- **Errors and cancellations** — if something went wrong, the details appear here.

Consecutive tool calls share one **Activity** card. Open it to inspect each call and its output. Retry and recovery notices appear in a separate compact box; open it to see the full list, including errors from earlier retries. Messages and inline files stay in the conversation.

## Organizing a long conversation

Open **Messages** to navigate with **Map**, **Outline**, or **List** in one panel. You can resize or expand the panel; on smaller screens it opens over the conversation.

- **Outline** collects the key points first, followed by a selective chronological log. The assistant creates it when a lesson or extended task would benefit from one and reviews it after each reply. Follow its links to revisit a message, or use the down arrow to reach the end of the log.
- **Map** shows how turns connect, with the main discussion emphasized and side questions branching off. Click a turn to expand its full summary, then use its arrow button to jump to the message. Click again to collapse the summary. You can also collapse a branch or use the zoom and current-turn controls to find your place. These links help you navigate; they do not change the conversation the assistant sees.
- **List** shows a one-line summary for each exchange. Older turns use a message preview until a summary is available. Turn off **Show message summaries** in the message display settings to see individual message previews.

The outline and map refresh after replies without resetting your reading position. Ask in chat to correct their organization. Existing conversations can acquire an outline and map when you continue them, and switching conversation branches shows the organization saved for that branch.

Workspace owners can turn this feature on or off under **Workspace settings → Experiments → New message organization**. It is on by default. Turning it off restores the usual message list and keeps saved outlines and maps for later. A running turn uses the setting it started with.

## Workflow panel

If the task uses **Long Horizon**, **Deep Research**, **Quality control**, or **Agent Swarm**, Task Detail also shows a dedicated workflow panel above the main conversation.

### Long Horizon, Deep Research, and Quality control panel

The panel shows the state of the workflow at a glance:

- the saved plan,
- the latest submission,
- the current round,
- the reviewer verdicts.

You can open the full plan, full submission, and full review text from the panel.

For Deep Research tasks, the panel is labeled **Deep Research**. A rejected verdict means the reviewer found a source-quality, scope, or answer-structure problem that the task must correct before delivery. For Quality control tasks, it is labeled **Quality control** and a rejected verdict means the reviewer found writing, formatting, or design problems.

### Agent Swarm panel

The panel shows:

- the worker list,
- the channel list,
- live channel popups,
- live worker POV popups.

This makes it much easier to inspect the ongoing swarm discussion without digging through raw logs.

## Sending a follow-up message

While a task is `awaiting_input` or even after it has completed, you can type a follow-up in the input box at the bottom and press **Send**. This continues the same conversation — the agent sees the full history and your new message.

Use follow-ups to:
- Correct an error: _"The output file is missing the header row, please fix that."_
- Ask for clarification about what was done: _"Explain why you chose that library."_
- Extend the work: _"Now also generate a chart from `output/q1_summary.csv`."_
- Request a retry with different parameters: _"Retry the analysis but exclude January."_

## Starting a thread from an assistant reply

Sometimes you want to ask a narrow follow-up without derailing the main conversation. In Task Detail, hover an assistant message and click the **thread icon** to open a sidebar thread.

Threads are useful when you want to:

- ask a side question about one part of the reply,
- explore an alternative approach without cluttering the main task,
- or keep a focused mini-conversation tied to a specific assistant message.

If you highlight text inside an assistant reply, Meowbert also shows an **Ask in thread** action right next to the selection so you can start a thread from that exact excerpt.

### How threads behave

- Threads open in a **right sidebar** so the main conversation stays visible.
- The sidebar is **resizable** on desktop.
- Thread replies stay inside that thread instead of appearing in the main task history.
- Existing threads on a message can be reopened from the same thread icon.

## UI preferences

Open **Preferences** from the app sidebar if you want to change how task conversations behave.

Right now, the **UI** tab includes:

- **Enable Threads popup** — controls whether the inline **Ask in thread** popup appears when you select text in an assistant reply.
- **Send with Shift+Enter** — changes message sending so `Shift+Enter` sends and plain `Enter` inserts a newline.

These preferences are saved to your account, so they follow you across workspaces and future sessions.

## Editing a previous message (branching)

You can click the **edit icon** on any of your previous messages to change what you said. When you do:

1. Meowbert saves a **branch** at that point in the conversation.
2. The agent re-runs from that message forward using your new wording.
3. The original branch is preserved — you can switch back to it at any time.

This is useful when your original prompt had a mistake, was ambiguous, or you want to explore a different direction without losing what came before.

## The Events tab

Click the **Events** tab in Task Detail to see a detailed log view with timestamps. This is where you go when:

- A task appears stuck — inspect the last few commands to see what's happening.
- You want to understand exactly what the agent did and why.
- You need to copy a command that was run for debugging purposes.

## Cancelling a task

Click the **Cancel** button to stop a running task. The agent will receive a cancellation signal and stop after its current step. Already-written files are not automatically deleted.

## Re-running a completed task

After a task completes, you can start a fresh run from the same prompt by following up with a new message, or by opening a new task in the composer and duplicating the prompt.

## Watching for compaction events

For long-running or multi-turn tasks, you may see a **context compaction** event in the stream. This means the conversation history was automatically summarized to keep the context window within model limits. Your follow-up messages still have access to all relevant prior context — the summary preserves goals, decisions, and open items. See [Context Compaction](/core-workflows/context-compaction) for more.

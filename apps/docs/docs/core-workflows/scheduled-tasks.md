---
title: Scheduled, Infinite & Timed Tasks
summary: Run a task on a schedule, keep it working in a loop, or give it a time budget, and get the results when it's done.
onboardingId: scheduled-tasks
checklistLabel: Scheduled tasks
---

# Scheduled, Infinite & Timed Tasks

A standard task runs once and stops when it has an answer. For work that should repeat, or keep going for a long time, open the **task parameters** menu next to **Tools** and **Sources** in the composer and pick a schedule.

| Type | What it does | Good for |
| --- | --- | --- |
| **Scheduled task** | Runs again on a cron schedule, in your chosen timezone. Each run continues the same conversation. | Daily reports, weekly checks, monitoring a page or feed |
| **Infinite task** | Keeps looping: after each run it starts the next one automatically until you stop it. | Ongoing background jobs, long investigations |
| **Timed task** | Loops like an infinite task, but stops after the number of minutes you set. | "Work on this for two hours" |

## Scheduled tasks

Enter a standard 5-field cron expression and a timezone. For example:

| Cron | Runs |
| --- | --- |
| `0 9 * * *` | Every day at 09:00 |
| `0 9 * * 1` | Every Monday at 09:00 |
| `*/30 * * * *` | Every 30 minutes |

## Waiting

Infinite and timed tasks can call a `wait` tool to pause until something changes, for example until a build finishes. Turn off **Allow waiting** under **Edit parameters** if the agent should keep working instead.

## Limits and results

- **Edit parameters** also sets a maximum number of steps and a time limit for each run.
- Your admin can cap how many recurring tasks each project and workspace can have active.
- Use [Notifications](/core-workflows/notifications) or a [connector](/core-workflows/connectors) such as Telegram to get results without keeping Meowbert open.
- To stop a recurring task, open it and choose **Clear schedule**, or cancel it from the task's menu.

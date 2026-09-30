---
title: Tool Options Reference
---

# Tool Options Reference

The Task Composer's **wrench menu** lets you enable optional capabilities for a task. This page describes each option in detail.

---

## Memory

**What it does:** Allows the agent to semantically search the workspace's persistent `.memory` directory during the task. Search results include snippets plus file paths and line ranges so the agent can inspect or update the underlying note.

**When it appears:** Only in workspaces where Memory is enabled in **Workspace Settings**.

**When to enable it:**
- The task should reuse durable project notes, decisions, or preferences.
- You want the agent to find the right Memory note before editing it.
- The workspace keeps long-lived references in `.memory`.

**When to leave it off:**
- The task is fully self-contained and doesn't need prior durable notes.
- You want the run to ignore existing Memory and work only from the prompt plus attached files.

See [Workspace Memory](/core-workflows/workspace-memory) for how `.memory` is organized.

---

## Web Search

**What it does:** Allows the agent to fetch real-time information from the internet during the task. The agent can search for current documentation, news, pricing, API references, or any other web content.

**When to enable it:**
- The task requires information that might have changed since the model's training cutoff.
- You want the agent to verify or cross-check facts against live sources.
- The task involves current pricing, availability, or status information.

**When to leave it off:**
- The task is self-contained (e.g., transforming files you've provided).
- You want fully reproducible, offline results.
- Latency is a concern — web search adds round-trip time.

---

## Schedule Tasks

**What it does:** Converts the task into a **recurring scheduled task** that runs on a defined interval. When enabled, a schedule picker appears in the composer where you can configure the frequency (e.g., every hour, daily at 9am, every Monday).

**When to enable it:**
- You want automated, periodic execution of a prompt (e.g., a daily report, a nightly cleanup job).
- You need the agent to check something on a regular schedule and notify you of changes.

**Limits:** Each project has a maximum number of active recurring tasks (configured by server admins). Check your workspace limits if you hit an error creating a scheduled task.

**Managing scheduled tasks:** Scheduled tasks appear in the Project Overview with the `scheduled` type badge. Cancel them from the overview to stop future runs.

---

## Subtasks

**What it does:** Allows the agent to create child tasks for scoped portions of the work. The parent task delegates to subtasks, waits for them to complete, and aggregates results.

**When to enable it:**
- The work is naturally parallelizable — for example, processing multiple files independently.
- The task is so large that breaking it into smaller pieces makes each more reliable.
- You want cleaner separation of concerns in the event log.

**When to leave it off:**
- Simple, single-step tasks — the overhead isn't worth it.
- You want a single coherent event stream without branching.

---

## Skills

**What it does:** Enables one or more **Skills** for the task. Skills are MCP (Model Context Protocol) tool packs that extend the agent with specialized capabilities beyond shell commands. When a skill is enabled, its tools are available to the agent during the task.

See the [Skills Reference](/reference/skills) page for descriptions of all available skills.

**When to enable it:**
- The task requires browser automation (use the **Browser Use** skill).
- The task needs to generate or manipulate Word documents (use **DOCX Studio** or **OpenAI: doc**).
- The task needs to generate or manipulate PowerPoint files (use **PPTX Studio**).
- The task needs a new PDF-only document (use **Typst**).

**Note:** Skills must be installed and configured on the server. Available skills vary by platform deployment. Contact your server admin if a skill you need isn't listed. You can enable more than one skill for the same task when the workflow spans multiple artifact types.

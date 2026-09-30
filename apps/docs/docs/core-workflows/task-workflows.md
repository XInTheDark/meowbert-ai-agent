---
title: Long Horizon, Deep Research, Quality control & Agent Swarm
summary: When one agent is not enough, use Long Horizon, Deep Research, Quality control, or an Agent Swarm of several models working together.
onboardingId: task-workflows
checklistLabel: Workflows & Agent Swarm
---

# Long Horizon, Deep Research, Quality control & Agent Swarm

Most tasks should stay as **Standard tasks**. They are simpler, faster, and easier to steer.

When a task needs more structure, Meowbert offers four workflow modes in the Task Parameters menu:

- **Long Horizon** — for tasks that need a durable plan plus explicit review before they are allowed to finish.
- **Deep Research** — for source-aware research that should investigate both broadly and deeply before answering.
- **Quality control (Experimental)** — for tasks whose final writing, formatting, and visual presentation need a dedicated review pass.
- **Agent Swarm** — for tasks that benefit from multiple agents discussing the work together before a final answer is delivered.

You choose the workflow before sending the task.

## Long Horizon

Use **Long Horizon** when you want the agent to stay disciplined over a larger piece of work.

### What happens

1. A **clarify stage** runs first instead of starting execution immediately.
2. The agent asks clarifying questions if needed.
3. Once ready, it writes a durable `PLAN.md`.
4. The main agent executes against that plan.
5. When it thinks it is done, it submits its work to a reviewer.
6. The task only finishes once the reviewer approves.

### Why use it

Long Horizon is a good fit when:

- the task is broad and easy to half-finish,
- quality matters more than speed,
- you want a visible plan before deep execution starts,
- you want review pressure before the final answer is sent.

### What you see in Task Detail

The workflow panel shows:

- the saved plan,
- the latest submission,
- the current round,
- the reviewer verdicts for that round.

If a reviewer wants changes, the task keeps going instead of silently stopping early.

## Deep Research

Use **Deep Research** when you need a well-supported answer rather than a quick overview. It uses the same clarify, plan, execute, and review structure as Long Horizon, with research-specific guidance.

### What happens

1. The task clarifies the goal, audience, scope, freshness, or deliverable when that is genuinely needed.
2. It plans whether the task calls for deeper investigation of a specific subject, wider comparison across sources and viewpoints, or both.
3. The agent researches authoritative primary sources when they are required, while also using credible independent reporting, forums, or user accounts when they provide relevant real-world context.
4. It keeps you updated at meaningful research milestones instead of leaving you to wait without context.
5. The final report follows your requested format. Otherwise, it starts with the conclusion, explains the important evidence and uncertainty, and ends with the sources actually used.

### Why use it

Deep Research is useful when:

- you need an answer grounded in current documentation, reports, or public evidence,
- official information may be incomplete and independent reporting or user experience matters too,
- you need to compare competing claims, policies, products, or programs,
- you want a concise answer without losing the supporting evidence.

### What you see in Task Detail

The workflow panel is labeled **Deep Research** and shows the same plan, submission, review round, and reviewer verdicts as Long Horizon. A rejected review sends the task back to strengthen the research or answer before delivery.

## Quality control (Experimental)

Use **Quality control** when the way the result is presented matters as much as completing the underlying work. It uses the same plan-and-review structure as Long Horizon, but the reviewer concentrates on the experience of reading, viewing, or using the finished result.

### What happens

1. The task clarifies the request and writes a durable plan.
2. The main agent completes the work and prepares the full reply it intends to send.
3. It identifies every user-facing file or visual artifact it created or changed.
4. The reviewer checks the reply from the user's point of view and opens the actual output files.
5. Presentations, documents, PDFs, spreadsheets, webpages, canvases, and images are rendered or viewed when visual inspection applies.
6. The reviewer checks the result against Meowbert's writing style guide and requests another revision if wording, flow, formatting, or design problems remain.

### Why use it

Quality control is useful when:

- the final answer needs to be especially clear, natural, or easy to follow,
- a paper, report, or presentation needs a careful editorial pass,
- generated files must look polished rather than crowded or template-like,
- visual consistency, typography, spacing, and layout are part of the deliverable.

### What you see in Task Detail

The workflow panel uses the **Quality control** label and shows the same plan, submission, review round, and reviewer verdicts as Long Horizon. A rejected review keeps the task working until a corrected version is approved.

## Agent Swarm

Use **Agent Swarm** when one agent should not be the only voice working on the task.

### What happens

1. Meowbert creates **one leader** plus **2 to 16 workers**.
2. The leader starts the shared discussion.
3. Workers collaborate through shared swarm channels.
4. The leader is responsible for the final user-facing answer, but only after the swarm has discussed the work.

Before delivery, one worker gives the proposed answer a final read. If the swarm has a Quality Control worker, it does that pass; otherwise the leader asks another worker. If it needs changes, the leader addresses them and gets a new final pass.

This is intentionally different from subtasks. Subtasks are independent. An Agent Swarm is a shared discussion.

### Why use it

Agent Swarm is useful when:

- the task is ambiguous and you want multiple viewpoints,
- you want parallel investigation plus debate,
- verification matters and it is healthy for agents to challenge each other,
- you want to inspect how different workers approached the same problem.

### Configuring the swarm

In the composer, you can choose the **worker count**:

- minimum: **2**
- maximum: **16**

The leader is added automatically.

By default, a swarm has a token budget (and an optional time budget), and the leader can bring in extra agents as the work grows. Turn on **Disable spawning and budgets** to keep the swarm to the agents you picked, with no token or time budget.

### Tool access

Whatever tools you enable in the composer apply to the swarm too. If you enable Web Search, Memory, Computer Use, Subtasks, or Skills, the swarm agents receive those same selected capabilities for their runs.

### What you see in Task Detail

The workflow panel shows:

- the worker list,
- the channel list,
- live channel popups,
- each worker's live POV using the normal task detail renderer.

This makes it much easier to inspect who said what and what each worker is currently doing.

## Choosing the right mode

Use **Standard task** when:

- the task is straightforward,
- speed matters,
- one agent is enough.

Use **Long Horizon** when:

- you want a plan first,
- you want formal review before completion,
- you are worried about the agent stopping too early.

Use **Deep Research** when:

- source quality and current evidence matter,
- you need wide comparison, deep investigation, or both,
- you want the conclusion and the sources behind it in one organized result.

Use **Quality control** when:

- the writing and organization need an editorial review,
- the task produces visual or formatted deliverables,
- you want the output judged from the reader's or viewer's perspective.

Use **Agent Swarm** when:

- you want discussion between multiple agents,
- you want disagreement and verification,
- the task benefits from several concurrent perspectives.

## Important limits

- Workflow type is chosen at task creation time.
- After the task is created, the workflow type is fixed.
- You can still adjust normal task parameters like max steps or waiting behavior where supported.
- Enable **Web Search** in the composer when the research needs current web information. Other selected tools and sources remain available to the workflow too.
- Quality control is experimental and may take longer because revisions continue until the presentation-focused reviewer approves the result.

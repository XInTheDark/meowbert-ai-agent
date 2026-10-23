---
title: Long Horizon, Deep Research, Quality control & Agent Swarm
summary: When one agent is not enough, use Long Horizon, Deep Research, Quality control, or an Agent Swarm whose leader splits the work across copies of itself.
onboardingId: task-workflows
checklistLabel: Workflows & Agent Swarm
---

# Long Horizon, Deep Research, Quality control & Agent Swarm

Most tasks should stay as **Standard tasks**. They are simpler, faster, and easier to steer.

When a task needs more structure, Meowbert offers four workflow modes in the Task Parameters menu:

- **Long Horizon** — for tasks that need a durable plan plus explicit review before they are allowed to finish.
- **Deep Research** — for source-aware research that should investigate both broadly and deeply before answering.
- **Quality control (Experimental)** — for tasks whose final writing, formatting, and visual presentation need a dedicated review pass.
- **Agent Swarm** — for big tasks the leader can split across copies of itself, answer several ways at once, and have checked before delivery.

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

Use **Agent Swarm** when a task is big enough that one agent working alone would be slow, lose detail, or settle on its first idea.

An Agent Swarm is one agent, the **leader**, that can make copies of itself. You talk to the leader exactly as you would to a standard task. Most turns stay ordinary turns: a request like "rewrite this email to sound less defensive" is simply answered. When the work warrants it, the leader makes one of three moves.

### What the leader can do

- **Split.** The leader hands different parts of the work to **lanes**, copies of itself that start with everything it knows. Lanes work at the same time, and lanes building one thing share short notes with each other so they stay consistent. For example, a lane researching EU grants that finds a rule ruling out your company shares it, and the other lanes take it into account at their next step.
- **Diverge.** For a judgment call, the leader asks several lanes the same question. They answer without seeing each other, so they don't just agree with the first idea. The leader then compares their reasoning: where they agree, where they disagree, and ideas only one lane had. It builds its answer from the strongest one.
- **Check.** Before a reply that used lanes is delivered, a fresh reviewer that has seen none of the leader's reasoning reads what you asked and the draft, and looks for what is wrong. The leader fixes what it finds and then replies.

Lanes can split their own part again when it turns out to be bigger than expected.

Some examples:

| Request | What the swarm does |
| --- | --- |
| "Find every EU and Portuguese funding program a 10-person climate-tech startup could apply to in 2027" | The leader looks around, then splits into one lane per family of programs. Lanes share eligibility rules they discover. A reviewer spot-checks deadlines before the table is delivered. |
| "Propose pricing for our B2B analytics tool" | The leader diverges into three independent proposals, compares their key decisions, settles the one real disagreement with a focused lane, and builds from the best proposal. |
| "Turn these research notes into a 40-page market report" | The leader writes a short outline of terms and shared numbers first, then splits the sections across lanes. The reviewer looks for seams between sections. |

Small models make weaker leaders. Use a swarm whose leader runs on a strong model.

### Talking to the swarm while it works

The leader stays available while lanes work. Send a message at any time: the leader can tell you how far each lane has got, steer a lane, stop one, or start more.

After a reply, lanes stay **dormant** for a few turns with everything they found. When you ask a follow-up such as "go deeper on the EIC programs", the leader picks up the lane that already did that part instead of starting over.

### Why use it

Agent Swarm is useful when:

- the work has parts that can be done at the same time, such as research across many sources or sections of a long document,
- you want to see where an answer is uncertain, not just one confident path,
- you want a reply checked by a reviewer that does not share the author's blind spots.

For tightly connected, step-by-step work, a standard task is usually better.

### Configuring the swarm

Pick an Agent Swarm in the model list, or choose **Agent Swarm** in the Task Parameters menu. The swarm's settings start from its preset, and you can change them for this task:

- **Lane model router**, when your server has model routers: the leader can run some lanes on other models, for example a reviewer on a different model. Without one, every lane uses the leader's model.
- **Budgets** are off by default. Turn them on to give the leader and all lanes one shared token budget and an optional time budget. A part is held back for putting the answer together and checking it. Each lane gets a share; near the end of its share it is told to wrap up, and at the end it reports what it has. Every lane always reports something.
- **Advanced...** holds the limits: how many lanes a parent can start, how deep lanes can split, how many run at once, steps per lane, automatic Check, how many turns lanes stay dormant, and a few more.

### Tool access

Whatever tools you enable in the composer apply to the swarm too. If you enable Web Search, Memory, Computer Use, Subtasks, or Skills, the leader and its lanes receive those same selected capabilities.

### What you see in Task Detail

Under the leader message that started lanes, a compact block shows one row per lane: what it owns, its status, its latest note and its steps. Sub-lanes are listed under their lane. Open a lane to read its own conversation in the side panel, or stop it to make it report what it has now.

The header shows how many lanes are working, budget use when budgets are on, and the dormant lanes with a one-line summary each.

In the conversation, once the leader delivers its final answer, the work leading up to it, lane blocks included, folds into one **Worked for…** row above the answer. Files and any error notices stay visible.

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

- the work has independent parts that can run in parallel,
- you want independent answers compared rather than one path,
- you want a fresh reviewer to check the reply before it is delivered.

## Important limits

- Workflow type is chosen at task creation time.
- After the task is created, the workflow type is fixed.
- You can still adjust normal task parameters like max steps or waiting behavior where supported.
- Enable **Web Search** in the composer when the research needs current web information. Other selected tools and sources remain available to the workflow too.
- Quality control is experimental and may take longer because revisions continue until the presentation-focused reviewer approves the result.

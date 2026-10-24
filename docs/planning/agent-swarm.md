# Agent Swarm: Planning & Specs

Status: implemented (section 21, phases 1 to 6). Replaces the previous Agent Swarm (leader + workers + channels) entirely. No backward compatibility. Section 22 records choices made where this doc left a detail open.

- Part I explains what we are building and why.
- Part II specifies what changes in the code, including tearing down the current feature.

For implementers: build it in the phases of section 21, one phase per change, each passing `npm run test`, `npm run lint` and `npm run build`. Where this doc names an existing function or pattern to copy, copy it rather than inventing a parallel mechanism. Where it leaves a detail open, pick the simplest option that keeps the invariants in section 13.3 and the AGENTS.md contracts.

---

# Part I: Planning

## 1. Summary

An Agent Swarm is one normal Meowbert agent that can multiply itself. The user talks to a single agent (the **leader**) that behaves exactly like a standard task agent: same tools, same streaming, same follow-ups. When the work warrants it, the leader can make three moves:

- **Split**: fork copies of itself (**lanes**) that each take a different part of the work.
- **Diverge**: fork lanes that each answer the same question independently, then compare.
- **Check**: hand the deliverable to a fresh reviewer that has none of the author's reasoning.

Lanes are forks of the leader's conversation, so they inherit its full context from the provider's prompt cache at roughly a tenth of the input price. Lanes that work on parts of one thing stay consistent through short **notes**. The runtime owns all waiting: no agent ever pauses itself, waits on another agent, or schedules anything.

Coding is not the main use case. The design targets general work: research, analysis, decisions, writing, documents, and code when it comes up.

## 2. Goals and non-goals

Goals:

- It feels like working with a normal agent. Most turns are ordinary turns; the swarm shows up only when it helps.
- Every mechanism removes a specific limitation of a single-threaded agent. Mechanisms that do not are left out.
- Efficient by construction: shared prefix caching, bounded fan-out, no conversational chatter between agents.
- Nothing can deadlock, because agents cannot wait on each other.
- Every limit is configurable per preset and per task.

Non-goals:

- Free-form agent-to-agent conversation. It amplifies tokens, causes conformity, and needs deadlock handling.
- Compatibility with the current swarm's tasks, presets or data.
- Training an orchestrator. We rely on structure, guidance and logged outcomes.

## 3. What a single agent cannot do

Each part of the design maps to one of these.

| # | Limitation of one agent | What it looks like |
|---|---|---|
| L1 | Serial time: steps happen one after another. | A 120-step research task takes 40 minutes even when its parts are independent. |
| L2 | One context window: it fills, gets compacted, loses detail, and attention degrades in long contexts. | By step 80 it has forgotten the eligibility rule it read at step 12. |
| L3 | Path dependence: it commits early to one framing and later reasoning builds on it. | It ranks options by the first criterion it thought of and never revisits that choice. |
| L4 | Self-review: checking its own work shares its own blind spots. | It confirms a number by re-reading the same wrong cell. |
| L5 | Satisficing: it finds "enough" and stops. | It lists 8 grant programs when 19 exist. |
| L6 | It is busy: while working, it cannot talk to you. | You wait 40 minutes with no way to ask how it is going. |

## 4. The design

### 4.1 Three moves and an available leader

**Split** (fixes L1, L2, L5). The leader forks lanes that each take a different part of the work. Lanes inherit the leader's full context, so nothing is lost in a brief and nothing has to be rediscovered. Split lanes see each other's notes, because they are building one thing and must stay consistent.

**Diverge** (fixes L3). The leader forks lanes that each answer the same question. Each lane gets a direction (an angle the leader can name) or none at all (plain independent sampling); at least one lane is always undirected, so the spread is not limited to what the leader can imagine. Diverge lanes see nothing from each other until all have submitted, because independence is the whole point and it disappears the moment they see each other's views. When they finish, the leader compares them. Where they agree, confidence is high. Where they disagree is the most useful output of the move: it marks exactly where the answer is uncertain, which no single agent can tell you about its own reasoning. Ideas that only one lane had are the other prize: Diverge covers more of the idea space, not just more opinions.

**Check** (fixes L4). A fresh lane, not a fork, receives the user's messages, the deliverable and its files, and tries to find what is wrong. It must not be a fork: inheriting the author's reasoning means inheriting the author's blind spots. Check runs automatically before delivery on any turn that used lanes.

**The leader stays available** (fixes L6). While lanes work, the leader's turn is over. A user message starts a normal leader run that sees each lane's live status and notes, so it can answer ("B has found 11 programs so far, C is stuck on regional funds"), redirect a lane, stop one, or start another.

**When not to use any of it.** Tightly coupled, sequential work does not get lanes; that is where multi-agent setups lose to a single agent. A request like "rewrite this email to sound less defensive" is answered directly by the leader, exactly as a standard agent would. A swarm that always swarms is a bad agent.

### 4.2 Notes: keeping parallel work as consistent as serial work

A single agent never acts on a fact it has already disproved, because its own discoveries reach it immediately. Parallel lanes lose that property. Notes restore it, and nothing more elaborate is needed:

- **Shared notes**: a lane calls `share(text)` for anything that would change how a sibling acts: a finding, a decision, a warning.
- **Automatic notes**: the runtime records which files a lane wrote and which sources and searches it opened. Models under-report what they are doing, so the notes that prevent duplicated work must not depend on their discipline.
- **Delivery**: new notes arrive at the lane's next step boundary, usually seconds away, appended at the end of its conversation so its cache stays valid.

A lane can still ignore a relevant note. A single agent sometimes ignores its own earlier discovery too, so this is parity, not a new failure. The merge and the Check lane are the backstop.

### 4.3 Consistency for split deliverables: the spine

When lanes write parts of one deliverable, a single agent gets consistency for free but loses detail (L2); lanes keep the detail but leave seams: different terms, numbers that do not match, repeated content, no thread connecting the parts.

- **Spine first.** Before splitting a deliverable, the leader writes a short spine file: outline, key terms, shared numbers and assumptions, voice and format, and what each part owes the others ("Section 3 defines TAM; Sections 4 and 5 use that number"). Lanes are forked after it exists, so it is in every lane's context.
- **Spine changes go through notes.** A lane that needs to change the spine shares the change; siblings see it at their next step. The spine file itself is updated only at merge, so it never changes underneath a lane mid-write.
- **Results have two parts**: a short summary that goes into the parent's context, and artifacts that stay as files in the lane's directory. The leader's context grows by the summaries, not by the deliverable.
- **Assembly is a lane when it is big.** When the parts are large, the leader forks one assembly lane after the merge. It has the spine, all summaries and the part files, and its only job is joining: transitions, removing duplication, making terms consistent. It does not rewrite content.
- **Check looks for seams first** on split deliverables: contradictions between parts, mismatched numbers, repeated content, and promises the spine made that a part did not keep.

### 4.4 Comparing diverged results

Comparing several full outputs side by side is expensive and biased (judges favour whatever comes first and whatever is longest), and "synthesize all of them" tends to produce a stitched-together result.

- **Decision record.** Each Diverge lane submits, next to its output, its key choices, each with the reason and what would make it choose differently. "What would change my mind" is what makes disagreements visible. Confidence scores are left out because models calibrate them poorly.
- **The leader reads the decision records**, which are short, and sees what is agreed, what is disputed, and what is unique.
- **Lanes are anonymized and shown in random order** to the leader.
- **Build from the best, do not blend.** The leader picks the best whole output as the base, then adds unique ideas and the resolution of disagreements into it.
- **Disagreements are settled with Split, never with another Diverge.** A disputed choice becomes a focused Split lane ("model margin under per-seat vs usage-based pricing for our three customer profiles"). This keeps divergence from recursing.

### 4.5 Recursion

A lane can split or diverge itself. The leader cannot see the full shape of the work at the start: in the grants example below, the EU lane discovers that one program alone has four separate funding instruments. It splits them itself instead of doing them one after another or going back to the leader.

- Depth is limited (default: lanes and sub-lanes, two levels below the leader).
- A lane that splits ends its turn like the leader does, resumes when its children finish, then submits upward. The leader only ever sees its direct lanes' summaries.
- Diverge lanes may split to build their own answer but cannot diverge again: three lanes each diverging three ways is nine times the cost for little gain.
- Check lanes cannot split or diverge.
- Sub-lanes fork from their parent lane, whose history starts with the leader's, so the cache chain holds: leader prefix, then lane prefix, then sub-lane.

### 4.6 Follow-ups: lanes go dormant

After delivery the user asks "go deeper on the EIC programs". The leader only holds summaries; re-forking would redo the research. So a lane that has submitted goes **dormant** instead of disappearing. The leader sees dormant lanes as one line each ("A: EU programs, 23 sources read") and can resume one with its full detailed context. Within the provider's cache window this is cheap; after that, it pays one uncached read of the lane's context (about 80k tokens), which is still far cheaper than redoing 25 research steps. Dormant lanes expire after a configurable number of user turns, or when the task is archived. This gives the swarm a standing team for the length of a conversation without a separate system.

### 4.7 Models

Forks share the cache only on the same model as their parent. That settles model choice:

| Lane kind | Default model | Why |
|---|---|---|
| Split, Diverge | Parent's model, forked | Cache sharing is the main cost win, and one strong model sampled several times usually beats mixing models (Self-MoA). |
| Diverge (optional) | One lane on a different model | Different priors widen the spread. It pays for the prefix uncached once. |
| Check | A different model when available, always fresh | Independence matters most here; a reviewer from the same family shares the author's blind spots. |

A swarm preset may name a **model router**. With a router, the leader picks a model for each lane from the router's targets, the way the Project Master picks a model for a task it creates. Without a router, every lane runs on the root model. Many platforms have only one suitable model, so a different model is guidance, never a requirement. This is clean and still acceptable.

### 4.8 The leader's judgment

Orchestrators fail in two ways: never splitting (everything done serially) and splitting pointlessly (many lanes, no real decomposition). Kimi trained against both with reinforcement learning; we cannot train, so the runtime removes judgment calls where it can:

- **Check is automatic** on any turn that used lanes. No judgment needed.
- **Recon nudge**: after a configurable number of solo steps in one turn, a single appended note asks the leader to split or carry on. It is a nudge, not a requirement.
- **Guards against pointless splitting**: each lane must name a concrete part, fan-out per parent is capped, and when budgets are on each lane needs a minimum share.
- **Clear criteria in the prompt**: independent parts, use Split; cannot be checked mechanically and worth roughly 3x the cost, use Diverge; otherwise do the work directly.
- **Outcome logging**: for every lane, record its kind, cost, duration, whether it was merged or stopped, and what Check found. Admins get a per-model view of whether leaders use lanes well, and we get evidence for tuning the guidance.

Small models make weak leaders. A preset should use a strong model for the leader; lanes inherit it.

### 4.9 Budgets

Budgets are optional and off by default. Without them, a swarm is bounded by fan-out, depth, the cap on running lanes, and each lane's step limit. With them, the leader and all lanes share one token budget (and optionally a time budget):

- A share is held back for merge, assembly and Check.
- The rest is divided across lanes, equally unless the parent gives weights; a sub-lane's share comes out of its parent's share.
- At a configurable fraction of its share, a lane is told to wrap up. At its share, the runtime forces its final summary step. A lane always returns something, so work is never stranded.
- Budget cannot be moved between running lanes. A parent can resume a lane with more budget at merge time, which is simpler than live rebalancing and nearly as good.

## 5. Walkthroughs

### 5.1 Research coverage (Split)

Request: "Find every EU and Portuguese public funding program a 10-person climate-tech startup in Lisbon could apply to in 2027, with deadlines, amounts and eligibility. Our company profile is attached."

A single agent searches, opens about 40 pages and builds a table. By step 60 its context holds about 150k tokens of web pages and it compacts. The compaction keeps "EIC Accelerator, EUR 2.5M" but drops the detail that SME status fails when a large enterprise owns more than 25%, which matters because a corporate VC owns 30% of this startup. It stops at 9 programs and marks several as eligible that are not (L2, L5, L1).

The swarm:

1. **Recon, about 10 steps.** The leader reads the profile and runs broad searches. The space falls into five families: Horizon Europe/EIC, LIFE, Innovation Fund, PT2030 national programs, regional and municipal funds. Its context is about 30k tokens.
2. **Split into 5 lanes**, one per family. Each is a fork, so each knows the profile in detail, including the 30% corporate stake. A fresh subagent would only know what its brief said.
3. **Work.** Notes look like:
   - (auto) `B opened 6 pages (cinea.ec.europa.eu, ...)`
   - `A: SME status fails if >25% owned by a large enterprise. Our 30% corporate stake may disqualify us from anything requiring SME status unless the investor counts as an exempt VC fund. Checking.`
   - `A: Confirmed: the investor is a corporate VC arm, not exempt.`

   Lanes D and E see A's note at their next step and re-check their programs. This is the moment that matters: isolated subagents would each have decided SME eligibility on their own, inconsistently. With notes the swarm is as consistent as one agent, without the compaction loss.
4. **Recursion.** Lane A finds the EIC has four instruments with different rules and splits them into sub-lanes.
5. **Submit.** Each lane submits its rows and sources.
6. **Merge.** The leader assembles one table. Automatic notes already prevented most duplicated reading.
7. **Check.** A fresh lane on a different model receives the user's messages, the profile and the table. It spot-checks deadlines against sources and catches an expired 2026 deadline.
8. **Deliver.** About 19 programs with consistent eligibility, in about 8 minutes instead of 40. Midway, the user asked "how's it going?" and got an answer from the leader.

Cost is the surprising part: it is cheaper than one agent. Assume each step adds about 2k tokens of context.

- One agent, 125 steps from a 30k start: input per step grows from 30k to 280k, about 19.5M input tokens in total, and it must compact.
- Five lanes, 25 steps each, each from the shared 30k: about 1.4M per lane, about 7M in total, and no lane exceeds 80k of context.

Splitting reduces how much context each step carries, so it saves money and improves quality at the same time.

### 5.2 A judgment call (Diverge)

Request: "We're launching our B2B analytics tool. Propose pricing: tiers, price points, and what's in each. Our cost data and three competitors' pricing pages are attached."

A single agent anchors on its first framing, usually "match competitors' per-seat model", and polishes it. The output looks confident and gives no hint that it is one path among several (L3).

The swarm:

1. **Recon.** The leader reads the cost data and competitor pages.
2. **Diverge into 3 lanes**, mutually blind: "price on value delivered", "price to undercut and win share", and one undirected.
3. **Submit.** Each returns a full proposal plus a decision record.
4. **Compare.** The leader reads the decision records (anonymized, shuffled). All three include a free tier and gate SSO in the top tier: agreed, high confidence. They disagree on per-seat versus usage-based pricing: a disagreement. One lane alone proposed an annual-prepay discount for the mid tier: unique.
5. **Settle the disagreement with Split.** One lane: "Using our cost data, model gross margin under per-seat vs usage-based pricing for our 3 customer profiles."
6. **Build from the best.** The leader takes the strongest proposal as the base and adds the unique idea and the margin result.
7. **Check, then deliver.** The recommendation states what is solid, what depends on what, and the margin model behind it.

The single agent's answer hides where it is fragile; this one shows exactly that. It costs roughly 3x a single agent, so Diverge is for decisions like this, not routine work.

### 5.3 A long deliverable (Split with a spine)

Request: "Turn these three research notes into a 40-page market report."

1. Recon: the leader reads the notes and writes the spine: outline of 6 sections, terms, the TAM figure and its source, voice, and which section defines what.
2. Split into 6 lanes, one section each. A lane shares "TAM should exclude public sector buyers; the notes double-count them." Siblings adjust at their next step; the leader updates the spine at merge.
3. Merge: six summaries enter the leader's context; sections stay as files. The parts total about 40k tokens, so the leader forks an assembly lane to join them.
4. Check looks for seams first, finds that section 5 still uses the old TAM in one chart caption, and the leader resumes that section's lane to fix it.

### 5.4 Follow-up

Next day: "Go deeper on the EIC programs." The leader resumes the dormant EIC lane with that message. It already has every page it read in context; it continues from there and submits an expanded section.

### 5.5 Nothing to swarm

"Rewrite this email to sound less defensive." The leader answers directly. No lanes, no Check, no delay.

## 6. Scaling

- **Lanes form a tree with bounded fan-out.** Default 8 children per parent, depth 2: at most 8 + 64 lanes. Each parent merges only its own children, so no agent reads more than 8 summaries (about 12k tokens).
- **Notes are scoped to siblings.** A lane sees notes from its siblings and its ancestor lanes, not from distant branches; information between branches flows through merges. What each lane reads therefore grows with fan-out, not with the total number of lanes. A design where every agent sees every other agent's state grows with N.
- **Forks stay cheap.** The leader forks right after recon. If its context is past a threshold (default 60k), the runtime compacts once and every lane forks from that same compacted copy, so lanes still share a cache with each other; the leader keeps its full context.
- **The database stays simple.** Append-only lanes and notes. With budgets on, spending is one atomic update per step on the swarm row; at 200 lanes and a step every 10 seconds that is about 20 updates per second, which is trivial for Postgres.
- **The real limit is provider rate limits.** A global cap on running lanes (default 32) queues the rest, finishing sibling groups first so parents unblock sooner (the critical-path idea behind Kimi's "critical steps").

## 7. Known limits

- **Leader quality bounds the swarm.** Mitigated by the guards in section 4.8 and by using a strong leader model; not eliminated.
- **A lane can ignore a note.** Parity with a single agent; the merge and Check are the backstop.
- **Forking a very long conversation** costs every lane step a large cached input. Mitigated by the compacted fork.
- **Cross-model lanes lose cache sharing** and drop provider-specific reasoning items from the inherited history. Acceptable because they are opt-in through the router.
- **Assembly of very large deliverables** is real work; it is given to a lane rather than done in the leader's context.

## 8. Evidence

- Parallel breadth is the proven win: Anthropic's lead agent with subagents beat a single agent by about 90% on breadth-first research; Kimi reports BrowseComp rising from about 60% to 78% with its swarm and measures latency on the critical path.
- Independent attempts compared through compact summaries work: Behavior Best-of-N reached about 70% on OSWorld (human baseline 72%) by judging short narratives of each attempt.
- One strong model sampled several times usually beats mixing models (Self-MoA).
- Free-form debate fails mostly through conformity: agents side with the majority or the seemingly smartest agent, and agree too fast. Independence, anonymity and sparse communication help.
- Seeing each other's work as it happens reduces duplicated work and catches errors (Hogwild!, Group Think); notes are the agent-level version.
- Forked agents that repeat the parent's prefix read it from cache at roughly 10% of the input price.
- More agents is not automatically better: gains depend on how the task decomposes and shrink as single models get stronger.

References:

- [Anthropic: How we built our multi-agent research system](https://www.anthropic.com/engineering/multi-agent-research-system)
- [Kimi K2.5](https://www.kimi.com/blog/kimi-k2-5) and [Kimi Agent Swarm](https://www.kimi.com/help/agent/agent-swarm)
- [Scaling Agents for Computer Use (Behavior Best-of-N)](https://arxiv.org/abs/2510.02250)
- [Rethinking Mixture-of-Agents (Self-MoA)](https://arxiv.org/abs/2502.00674)
- [Hogwild! Inference](https://arxiv.org/abs/2504.06261) and [Group Think](https://arxiv.org/abs/2505.11107)
- [Why Do Multi-Agent LLM Systems Fail?](https://arxiv.org/abs/2503.13657)
- [An Empirical Study of Group Conformity in Multi-Agent Systems](https://arxiv.org/abs/2506.01332)
- [Improving Multi-Agent Debate with Sparse Communication Topology](https://arxiv.org/abs/2406.11776)
- [Rethinking Multi-Agent Collaboration: When More Is Less](https://arxiv.org/abs/2609.19759)
- [Forked vs Fresh Subagents](https://agentpatterns.ai/patterns/multi-agent/forked-vs-fresh-subagents/)

---

# Part II: Specs

## 9. Glossary

| Term | Meaning |
|---|---|
| Swarm | A task created with an `agent_swarm` preset. Its root task is the leader's task and the user's conversation. |
| Leader | The root agent. A standard task agent plus the swarm tools. |
| Lane | A child task forked (or, for Check, freshly started) by the leader or by another lane. |
| Parent | The leader or lane that created a lane. |
| Lane kind | `split`, `diverge` or `check`. |
| Note | A short line in the shared notes, either shared by a lane or recorded automatically. |
| Spine | A file the parent writes before splitting a deliverable: outline, terms, shared numbers, voice, cross-part contracts. |
| Decision record | The list of key choices a Diverge lane submits, each with the reason and what would change it. |
| Dormant | A lane that has submitted and can still be resumed. |

## 10. Configuration

### 10.1 Preset JSON

An `agent_swarm` preset in the admin model settings:

```json
{
  "id": "research-swarm",
  "name": "Research Swarm",
  "mode": "agent_swarm",
  "leaderAgentId": "gpt-5-5",
  "routerId": null,
  "spawnEffort": 3,
  "budgetsEnabled": false,
  "tokenBudget": null,
  "timeBudgetMinutes": null,
  "advanced": {
    "maxLanesPerParent": 8,
    "maxDepth": 2,
    "maxRunningLanes": 32,
    "laneMaxSteps": null,
    "reconNudgeSteps": 12,
    "forkCompactionThresholdTokens": 60000,
    "laneSummaryMaxTokens": 1500,
    "assemblyHintTokens": 15000,
    "dormantLaneTurns": 3,
    "autoCheck": true,
    "budgetReservePercent": 15,
    "laneWrapUpPercent": 80
  }
}
```

| Field | Default | Range | Meaning |
|---|---|---|---|
| `leaderAgentId` | required | a standard (non-swarm) preset | The leader's agent preset. Lanes inherit its model unless a router pick says otherwise. |
| `routerId` | `null` | an existing model router or null | When set, the leader picks lane models from this router's targets. When null, every lane uses the root model. |
| `spawnEffort` | 3 (Balanced) | 1 to 5 | Convenience delegation profile. It scales fan-out, depth and the recon nudge; 3 preserves the normal defaults. It does not change budgets or the running-lane cap. |
| `budgetsEnabled` | `false` | boolean | Turns token/time budgets on. |
| `tokenBudget` | `null` | 1 to 100,000,000 weighted tokens | Used only when budgets are on. When on and null, defaults to 10,000,000. |
| `timeBudgetMinutes` | `null` | 1 to 10,080 | Used only when budgets are on. Null means no time budget. |
| `advanced.maxLanesPerParent` | 8 | 1 to 16 | Fan-out cap for any parent. |
| `advanced.maxDepth` | 2 | 1 to 3 | Lane levels below the leader. 1 disables recursion. |
| `advanced.maxRunningLanes` | 32 | 1 to 128 | Lanes running at once across the swarm; the rest queue. |
| `advanced.laneMaxSteps` | `null` | 1 to 500 or null | Step limit per lane run. Null inherits the task's max-steps setting. |
| `advanced.reconNudgeSteps` | 12 | 0 to 100 | Solo leader steps in one turn before the one-time split nudge. 0 disables it. |
| `advanced.forkCompactionThresholdTokens` | 60,000 | 10,000 to 400,000 | Above this parent context size, lanes fork from one shared compacted copy. |
| `advanced.laneSummaryMaxTokens` | 1,500 | 256 to 8,000 | Cap on a lane's submitted summary. |
| `advanced.assemblyHintTokens` | 15,000 | 1,000 to 200,000 | When merged parts exceed this, the merge message suggests an assembly lane. |
| `advanced.dormantLaneTurns` | 3 | 0 to 20 | User turns a submitted lane stays resumable. 0 disables dormancy. |
| `advanced.autoCheck` | `true` | boolean | Run Check automatically before delivering a turn that used lanes. |
| `advanced.budgetReservePercent` | 15 | 5 to 50 | Share of the budget held for merge, assembly and Check. Budgets only. |
| `advanced.laneWrapUpPercent` | 80 | 50 to 95 | Fraction of a lane's share at which it is told to wrap up. Budgets only. |

Removed from swarm presets: `modelAllocations`, `reviewRounds`, `disableSpawningAndBudgets`, `spawnableAsNode`, nested swarm compilation, and the worker-count roster.

### 10.2 Composer

When the selected agent is a swarm preset, the Task Parameters menu shows:

- Router (only if the platform has routers), prefilled from the preset.
- Effort, a 1-to-5 delegation profile with Balanced preserving the normal behavior.
- A Budgets switch, prefilled from the preset (off by default), with token and time fields when on.
- An **Advanced...** section, collapsed, containing every `advanced` field above, prefilled from the preset.

No worker count, no roster editor, no review rounds. Per AGENTS.md, no decorative copy above the composer.

### 10.3 The preset contract

Every swarm parameter the composer can set must also live on the preset. Update together, for each field above:

- `PlatformAgentPreset` and its normalizer in `packages/shared/src/agent-presets.ts`, with defaults and ranges in a new `packages/shared/src/agent-swarm-config.ts`.
- The admin preset schema in `apps/api/src/routes/admin-core-routes.ts`.
- The admin JSON draft parser in `apps/web/src/pages/admin/settings/adminSettingsDrafts.ts` and the preset editor UI (section 17.3).
- `resolveAgentSwarmSettings` (the replacement for `resolveAgentSwarmTaskSettings`) in `apps/api/src/services/agent-swarm/settings.ts`.
- The composer prefill in `apps/web/src/task/agentSwarmPresetWorkflow.ts`.

Update the "Agent Swarm preset contract" section of AGENTS.md to name these files and drop the old ones.

### 10.4 Settings resolution

`resolveAgentSwarmSettings(requestWorkflow, preset)` returns the effective config: request values override preset values field by field; missing fields fall back to preset, then to defaults; everything is clamped to the ranges above. When `budgetsEnabled` is false, `tokenBudget` and `timeBudgetMinutes` resolve to null. The resolved config is stored on the swarm row (section 12) and never re-read from the preset during the task.

## 11. Runtime behaviour

### 11.1 The leader

- The leader is the root task. Its runs use mode `agent_swarm_leader`. Its tool set is the normal task tool set (whatever the user selected) plus the swarm tools.
- Its system prompt is the standard prompt plus the swarm guide (section 15), added as the `workflow-guide` envelope delta in `setup.ts`. The guide covers both the leader and lane roles, so lanes can inherit the same prefix unchanged.
- **Swarm tasks require context management v2.** Run preparation forces the requested version to `v2` for the swarm root and every lane, so `resolveFrozenContextManagementVersion` freezes v2 on their first run. Fork seeding (section 13) is defined only for v2 windows.
- If it never splits, the task is an ordinary task.

### 11.2 Split and Diverge: creating lanes

When the leader (or a lane) calls `split` or `diverge`:

1. Validation: the call must be the last tool call in the response; fan-out and depth limits; Diverge lanes cannot call `diverge`; Check lanes cannot call either. With budgets on, each lane's share must cover a minimum number of steps (a constant in `agent-swarm-config.ts`, computed from the minimum inference size per step).
2. In one transaction: insert one task and one `task_swarm_lanes` row per lane, record the fork source (section 13), set lane status `queued`, park the caller (section 11.4).
3. The scheduler starts lanes up to `maxRunningLanes` (section 11.9).
4. Each lane's tool result for the `split`/`diverge` call is lane-specific ("You are lane C: regional funds. ...", plus the spine path if any). The caller's own tool result lists the started lanes.

For `diverge`, if no direction is null, the runtime adds one undirected lane (counting toward the fan-out cap).

### 11.3 A lane's life

- **Running**: the lane works with the inherited tools. Before each model request, new notes in its scope are appended (section 11.6).
- **Submitting**: the lane calls `submit`. Its status becomes `done`, it goes dormant (section 11.8), and the barrier check runs for its parent.
- **Forced submit**: if the lane reaches `laneMaxSteps`, its budget share, the swarm deadline, or a `stop`, the runtime makes one final model call with `tool_choice` forced to `submit`. The tools array is unchanged, so the cache still holds. A lane always returns a summary.
- **Failure**: provider errors are retried by the existing run machinery. A lane that still fails ends as `failed` with an error summary, and the barrier treats it as finished.
- **Splitting**: a lane may split or diverge like the leader (depth permitting). It parks until its children finish, then continues and eventually submits.

### 11.4 Parking and the barrier

No agent waits. A parent that calls `split`, `diverge`, `check` or `resume` ends its run and is **parked**: its resume job is stored in `task_swarm_parks` and its run ends with exit reason `swarm_wait`.

Copy the existing subagent wait pattern, which already does exactly this:

- The tool handler sets a flag on the dispatch state (like `dispatchState.subagentWaitDeadline` in `agent-tool-dispatch/types.ts`), here `dispatchState.swarmPark = { reason }`.
- The loop breaks on it (like `loop.ts`, `if (execution.state.dispatchState.subagentWaitDeadline) return "break"`).
- `finalizeAgentRun` parks instead of finishing (like its call to `parkForSubagentMail` in `subagents/wait.ts`): insert the park row with the resume job, end the run with `swarm_wait`, finish the dispatch row, and set the task status the same way the subagent wait does.
- Waking mirrors `wakeTask` in `subagents/wait.ts`: under the task row lock, skip if a run is open, enqueue the stored resume job through the normal dispatch path, delete the park row.

The **barrier** for a parent is met when none of its direct children are `queued`, `running` or `waiting`. It is checked in the same transaction that changes a child's status, so no polling is needed. When met, the parent is woken; its run then receives the **merge message** (section 11.5).

A periodic recovery sweep finds parents whose barrier is met but which have no open run and no queued dispatch, and enqueues them. This follows the recovery contract: a missing queue job is a recovery condition, not a reason to cancel.

### 11.5 Merge message

The merge message is not stored. It is built when the parent's run starts, from the parent's direct children that are in a terminal state (`done`, `failed`, `stopped`) and have `merged_at IS NULL`. It is appended through `appendRunInboxItems`, whose claim callback sets `merged_at` in the same transaction, so each result is delivered exactly once even if the run is retried. Check findings and `resume` results arrive the same way (they are children too).

Contents, as one inbox item:

- For each lane: title, kind, status, summary, files, and cost when budgets are on.
- Diverge lanes: decision records, with lanes **anonymized and shuffled** ("Answer 1", "Answer 2", ...). The UI still shows real lane titles to the user.
- If the summed size of files written by the lanes exceeds `assemblyHintTokens`, a one-line suggestion to fork an assembly lane. Sizes come from the files the lanes wrote, tracked at write time, never from a directory walk.

### 11.6 Notes

- `share(text)` inserts a note with kind `shared`.
- Automatic notes (kind `auto`) are recorded in tool dispatch after successful file writes or edits, web searches, and page or URL opens. Within one step they are grouped into a single note per category, for example `B opened 6 pages (cinea.ec.europa.eu, portugal2030.pt, ...)`. Shell commands are not inspected.
- **Scope**: a lane receives notes whose author is a sibling (same parent) or an ancestor lane. Diverge lanes receive no sibling notes until their siblings have all submitted; ancestor notes are fine. Check lanes receive no notes.
- **Delivery**: before each model request, the runtime claims notes with `seq` greater than the lane's cursor and appends them as one compact block through the run inbox (`appendRunInboxItems`). Nothing is appended when there is nothing new. Delivery is append-only, so it never disturbs the cached prefix.

### 11.7 Check

- Triggered by `check(...)`, or automatically when `autoCheck` is on and the leader calls `final_response` after lanes were used since the user's last message and no Check has run since the last merge. Swarm runs, like other workflow runs, can only finish through `final_response` (plain text does not end the run), so the intercept lives in the `final_response` case of `agent-tool-dispatch/dispatch.ts`, where the old swarm review gate was. Instead of finishing, it starts a Check lane with the `final_response` text as the draft, returns a tool result saying the draft is being checked, and parks the leader. The draft is not delivered.
- The Check lane is a **fresh** task, never a fork. It receives: every message the user wrote in the conversation (current branch), the draft, the deliverable files, and the spine for split deliverables. It receives no assistant reasoning.
- Model: the leader's router pick when a router is set (guidance: prefer a different model than the author); otherwise the root model.
- Tools: the normal read and run tools of the task, write access limited to its own lane directory, and `submit`. No swarm tools.
- Output: `submit` with `findings`, each `must_fix` or `should_fix` with a location and a description. For split deliverables, the Check prompt puts seams first.
- The leader receives the findings as its merge message, fixes them itself or resumes the lane that owns that part, and replies again. That reply is delivered without another automatic Check. The leader may call `check` again after substantial fixes. Check never blocks delivery indefinitely.

### 11.8 Dormant lanes and resume

- A `done` lane stays resumable while the root task has received at most `dormantLaneTurns` user messages created after the lane's `merged_at`; then it becomes `expired`. This is computed from `task_messages` when listing or resuming, so no counter is needed. Archiving the task expires all lanes.
- At the start of each user turn, the runtime appends a list of dormant lanes, one line each, to the leader's conversation (never into the prefix).
- `resume(lane_id, message, extra_tokens)` appends the message to the lane's own conversation and runs it again; the caller parks until it submits. Only the lane's parent can resume it. `extra_tokens` adds to the lane's share when budgets are on.

### 11.9 Scheduling

- Lanes beyond `maxRunningLanes` stay `queued` without a dispatch.
- When a running lane ends, the scheduler starts the next queued lane, preferring lanes whose siblings are already running or done (completing sibling groups unblocks parents sooner), then FIFO.
- Lane runs go through the existing dispatch path (`insertTaskRunDispatchWithClient`).

### 11.10 User messages while lanes run

- The composer stays enabled. A user message while the leader is parked starts a normal leader run immediately.
- That run gets a status block appended: each active lane's title, status, step count, and latest notes. The leader can answer, `steer`, `stop`, start new lanes, or do nothing.
- When that run ends and lanes are still active, the leader is parked again: `finalizeAgentRun` delivers its `final_response` as a normal assistant message, then, if the leader has active children, parks it (reason `lanes`) instead of setting a terminal or awaiting-input status. No automatic Check runs for these interim replies, because no lanes have been merged since the user's message.
- If a user message arrives while the leader is resuming from a merge, it queues as a normal follow-up.
- In the UI, the user can also stop a lane directly from its track.

### 11.11 Steering and stopping

- `steer(lane_id, message)` appends the message to the lane's conversation at its next step boundary (through the run inbox). If the lane is dormant, use `resume` instead.
- `stop(lane_id, discard)`: `discard: false` triggers the forced submit; `discard: true` cancels the lane through the existing task cancellation path (which aborts in-flight requests via the run's abort signal) and its result is dropped. Stopping a lane stops its sub-lanes.
- Cancelling the swarm task cancels every lane.

### 11.12 Budgets

Only when `budgetsEnabled`:

- `task_swarms.spent_tokens` is charged after each model response with the weighted tokens from `recordSubscriptionUsage`, in one atomic update together with the lane's own `spent_tokens`. There are no reservations.
- Shares: at swarm creation, `budgetReservePercent` of the budget is held back. At each split, the parent's remaining share (the swarm's remaining minus reserve, for the leader) is divided across new lanes by `weight` (default equal). Sub-lane shares come out of the parent lane's share.
- At `laneWrapUpPercent` of its share, a lane gets a one-time wrap-up note. At 100%, forced submit.
- When the swarm total reaches the budget minus the reserve, every running lane gets the forced submit. The leader then works from the reserve to merge, check and deliver.
- Time budget: at the deadline, every running lane gets the forced submit and the leader resumes to deliver.
- `resume` with `extra_tokens` moves budget from the parent's remaining share to the lane.

When budgets are off, none of this runs; limits are fan-out, depth, running-lane cap and `laneMaxSteps`.

### 11.13 Models and the router

- No `routerId`: lanes use the root model and provider. The tools have no `model` parameter.
- With `routerId`: `split`, `diverge` and `check` lane entries get a nullable `model` parameter (enum of the router's target model ids) and, if the router allows reasoning effort, a nullable `effort` parameter. Their descriptions come from the router targets. Null means the parent's model.
- A pick is stored as a `ChosenModelRoute` on the lane and used for the lane's runs, exactly as the Project Master's pick is used for tasks it creates (no routing-model call).
- A lane on a different model than its parent still inherits the full forked history, without the cache discount. Provider-specific reasoning items are dropped when history moves to a different provider; messages and tool calls carry over.

### 11.14 Filesystem

- Each lane's task root is `<swarm task root>/lanes/<lane id>/`. Lanes write only there.
- Lanes can read the swarm root task directory and their ancestor lanes' directories (extend `resolveToolReadableRoots`).
- The spine is a file in the parent's directory; its path is passed in the `split` call.
- No directory walks anywhere (filesystem cost contract). File sizes for the assembly hint are recorded when lanes write files.

### 11.15 Outcome logging

Each lane row keeps kind, depth, model, steps, spent tokens, duration, final status, whether it was merged (submitted and not discarded), and the number of Check findings against it. An admin view aggregates these per leader model: lanes per turn, kind mix, stop and failure rates, Check findings per swarm turn.

## 12. Data model

One new migration (next number after the latest, currently `140_agent_swarm_lanes.sql`). Never edit applied migrations.

### 12.1 Teardown in the migration

- Delete the hidden worker tasks of old swarms: `DELETE FROM tasks WHERE workflow_type = 'agent_swarm' AND workflow_internal_role = 'worker'` (cascades their messages and runs). Their directories on disk are left for the project cleanup plan; no walk.
- Drop tables: `task_workflow_swarm_quota_reservations`, `task_workflow_swarm_quota_ledger`, `task_workflow_swarm_node_members`, `task_workflow_swarm_nodes`, `task_workflow_swarm_pauses`, `task_workflow_swarm_stalls`, `task_workflow_messages`, `task_workflow_channel_members`, `task_workflow_channels` (channels are swarm-only).
- Delete `task_workflow_agents` rows with role `leader` or `worker`, `task_workflow_submissions` of type `swarm_output`, and `task_workflows` rows with `workflow_type = 'agent_swarm'`.
- Narrow `task_workflows_workflow_type_check` to `('long_horizon')` and `task_workflow_agents` role check to `('main', 'reviewer')`.
- Old leader tasks keep `tasks.workflow_type = 'agent_swarm'` and their conversation. They have no `task_swarms` row, which marks them as legacy (section 14.4).

### 12.2 Constraints

- `tasks_workflow_internal_role_check`: allow `'reviewer', 'leader', 'worker', 'lane'`. `leader` stays for legacy root tasks; `worker` is carried forward harmlessly and no code writes it.
- `task_runs_run_kind_check`: carry forward every existing value and add `'agent_swarm_lane'`. Per the run-kind contract, update the shared/API/worker mode unions and the insert/enqueue regression tests together. `agent_swarm_worker` stays allowed for existing rows; no code produces it.

### 12.3 New tables

```sql
CREATE TABLE task_swarms (
  task_id uuid PRIMARY KEY REFERENCES tasks(id) ON DELETE CASCADE,
  config_json jsonb NOT NULL,
  token_budget bigint CHECK (token_budget IS NULL OR token_budget > 0),
  reserve_tokens bigint NOT NULL DEFAULT 0 CHECK (reserve_tokens >= 0),
  spent_tokens bigint NOT NULL DEFAULT 0 CHECK (spent_tokens >= 0),
  deadline_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE task_swarm_fork_seeds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  swarm_task_id uuid NOT NULL REFERENCES task_swarms(task_id) ON DELETE CASCADE,
  source_task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  envelope_json jsonb NOT NULL,
  tools_json jsonb NOT NULL,
  items_json jsonb NOT NULL,
  capabilities_json jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE task_swarm_lanes (
  task_id uuid PRIMARY KEY REFERENCES tasks(id) ON DELETE CASCADE,
  swarm_task_id uuid NOT NULL REFERENCES task_swarms(task_id) ON DELETE CASCADE,
  parent_task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  depth integer NOT NULL CHECK (depth >= 1 AND depth <= 3),
  kind text NOT NULL CHECK (kind IN ('split', 'diverge', 'check')),
  title text NOT NULL,
  direction text,
  status text NOT NULL CHECK (status IN ('queued', 'running', 'waiting', 'done', 'failed', 'stopped', 'expired')),
  model_route_json jsonb,
  fork_seed_id uuid REFERENCES task_swarm_fork_seeds(id) ON DELETE SET NULL,
  weight numeric NOT NULL DEFAULT 1 CHECK (weight > 0),
  share_tokens bigint CHECK (share_tokens IS NULL OR share_tokens >= 0),
  spent_tokens bigint NOT NULL DEFAULT 0 CHECK (spent_tokens >= 0),
  steps integer NOT NULL DEFAULT 0,
  wrap_up_notified boolean NOT NULL DEFAULT false,
  note_cursor bigint NOT NULL DEFAULT 0,
  result_json jsonb,
  merged_at timestamptz,
  check_findings integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  ended_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_task_swarm_lanes_parent ON task_swarm_lanes(parent_task_id, status);
CREATE INDEX idx_task_swarm_lanes_swarm ON task_swarm_lanes(swarm_task_id, status, created_at);

CREATE TABLE task_swarm_notes (
  seq bigserial PRIMARY KEY,
  swarm_task_id uuid NOT NULL REFERENCES task_swarms(task_id) ON DELETE CASCADE,
  author_task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  scope_parent_task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('shared', 'auto')),
  content text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_task_swarm_notes_scope ON task_swarm_notes(scope_parent_task_id, seq);

CREATE TABLE task_swarm_parks (
  task_id uuid PRIMARY KEY REFERENCES tasks(id) ON DELETE CASCADE,
  swarm_task_id uuid NOT NULL REFERENCES task_swarms(task_id) ON DELETE CASCADE,
  run_id uuid REFERENCES task_runs(id) ON DELETE SET NULL,
  resume_job_json jsonb NOT NULL,
  reason text NOT NULL CHECK (reason IN ('lanes', 'check', 'resume')),
  created_at timestamptz NOT NULL DEFAULT now()
);
```

`result_json` holds `{ summary, decisions, findings, files }` (section 16). Lane tasks set `workflow_type = 'agent_swarm'`, `workflow_internal_role = 'lane'` and `workflow_parent_task_id` = the swarm root. They do not use `parent_task_id`, so they never appear as subtasks.

### 12.4 Archive

Extend `packages/shared/src/task-history-archive.ts`: a swarm is archived and restored as a unit (root and lane tasks, `task_swarm_lanes.result_json`, `task_swarm_notes`, and `task_swarm_fork_seeds`, which are the largest payloads), preserving IDs. Remove the `workflow_messages` section; restoring an older archive that contains it ignores that section.

## 13. Fork mechanics

The cache only pays off if a lane's first request is byte-identical to its parent's last request up to the lane-specific tool result. Rebuilding a lane's request through normal run setup cannot achieve that: `setup.ts` builds a fresh envelope from the task's own state, and for v2 it prepends per-task window developer items (`buildV2WindowDeveloperItems`, `CONTEXT_WINDOW_GUIDANCE`) and appends workflow live state. So a fork is a **snapshot of the parent's exact request**, and lanes never go through normal setup.

### 13.1 Fork seed

When the `split` or `diverge` handler runs, it captures one **fork seed**, shared by every lane of that call, and stores it in `task_swarm_fork_seeds` (section 12.3):

- `envelope_json`: the parent's prompt envelope as serialized state: base frames and deltas. Queued conversation deltas are left out because they are already in the conversation items.
- `tools_json`: the exact `responseTools` array of the turn that produced the call, plus the code-mode nested tools if any.
- `items_json`: the exact conversation items the parent sent in that request, followed by the response's output items (including reasoning items) and the outputs of any other tool calls in the same response that were dispatched before this one. That is everything that precedes the call's own `function_call_output`.
- `capabilities_json`: what the tools depend on at run time: enabled skills and sources, tool options, model, provider and payload.

The dispatch context therefore needs access to the current turn's request snapshot (prefix items, conversation items, response tools, response output). Pass it in from `loop.ts` where the turn request is built.

The parent's own conversation continues normally with its own `function_call_output` ("Started lanes A, B, C").

### 13.2 Lane run setup

Lane runs (mode `agent_swarm_lane`, kinds `split` and `diverge`) use a dedicated setup path instead of normal run setup:

- **First run**: create the lane's v2 window and record `items_json` followed by the lane's own `function_call_output` (its title, direction and spine path) as its history.
- **Every run**, including resumes after parking and dormant resumes:
  - envelope: from the seed;
  - tools: `tools_json` verbatim, with the seed's capabilities enabled so the handlers work;
  - conversation: the lane's window items as stored, with no window developer items prepended and no live state appended.

  The lane's prefix is therefore identical across all its runs, and identical to its siblings' and parent's up to the fork point.
- New content during a run (notes, steering, merge messages, runtime notes) arrives only through the run inbox or post-seal envelope deltas, which append to the end.
- Context compaction of a lane works as for any v2 task; after a compaction the lane's prefix changes anyway.

Check lanes are **not** forks: they use normal run setup with the Check prompt, their own tool list, and their own v2 window.

### 13.3 Invariants

1. **Same tools array.** Tools sit at the start of the cached prefix. The leader and every forked lane expose the **same** tool list: the task's selected tools plus the full swarm tool set (`split`, `diverge`, `check`, `steer`, `stop`, `resume`, `share`, `submit`). Role restrictions are enforced in dispatch, which returns a tool error ("Only lanes can submit", "Maximum depth reached"), never by removing tools. A tool or skill that the parent enabled mid-run is already in the seed's tools array.
2. **Same prompt envelope.** Lane-specific instructions never go into the prefix; they arrive in the lane's tool result. The swarm guide in the prefix covers both roles.
3. **Same conversation.** Seed items followed by the lane-specific output; later items are the lane's own and append-only.
4. **Shared cache key, separate session affinity.** Today `buildPromptCacheKey(taskId, prefixHash)` keys on the task id, and `model.ts` sends the same value as `x-session-affinity`. Split them:
   - `prompt_cache_key` for a lane uses the **swarm root task id** with the inherited prefix hash, so all forks route to the same provider cache.
   - `x-session-affinity` stays per task (root key plus lane id). Session-resuming proxies such as Meridian require append-only history per affinity key; lanes diverge from the leader, so they must not share it.
5. **Warm cache.** The parent's own request that produced the `split` call already wrote the prefix to the cache, so lanes started right after hit it. No extra warm-up request.
6. **Compacted fork.** If the parent's context exceeds `forkCompactionThresholdTokens`, the handler runs one compaction (existing compaction service) on the seed items before storing them. Every lane in that call forks from that same compacted list, so lanes still share a cache with each other. The parent keeps its full context.
7. **Cross-model lanes.** If a router pick changes the model, the lane receives the same seed minus provider-specific reasoning items, built with that model's request normalization. No cache sharing is expected.
8. **Verification.** In development builds, log the lane's first `promptPrefixHash` next to the parent's for the same seed; they must match for same-model lanes.

## 14. API

### 14.1 Task creation

- `POST` task creation with an `agent_swarm` workflow: resolves settings (section 10.4), creates the root task, its first user message and the `task_swarms` row in one transaction, then enqueues the leader run in mode `agent_swarm_leader`. No other rows are created up front.
- Project Master managed tasks and scheduled tasks that use a swarm preset go through the same creation function.

### 14.2 Reads

- `GET /api/tasks/:taskId/swarm`: the lane tree (id, parent, depth, kind, title, direction, status, model, steps, spent, timestamps, summary when done) and swarm totals.
- `GET /api/tasks/:taskId/swarm/notes?after=<seq>`: notes for the whole swarm, for the UI.
- Live updates use the existing task event stream: emit events on lane status changes and new notes.

### 14.3 Actions

- `POST /api/tasks/:taskId/swarm/lanes/:laneId/stop` with `{ discard }`: the same behaviour as the `stop` tool, for the UI.
- Steering from the UI goes through the leader (a normal message); there is no direct user-to-lane message endpoint.

### 14.4 Legacy swarm tasks

A task with `workflow_type = 'agent_swarm'` and no `task_swarms` row is legacy. Its conversation stays readable. Any follow-up, retry, branch or replay request returns `409` with "This Agent Swarm task was created with the previous swarm version. Start a new task." The UI hides the composer for it and shows that line.

## 15. Prompts

Keep them short, natural and direct (AGENTS.md). Files under `prompt-texts/agent-swarm/`:

- `guide.md`: in the prefix for every forked swarm agent. Explains: you are one agent that can fork itself; when to Split, Diverge, Check, or just work; split right after recon; write a spine before splitting a deliverable; lanes share only what would change how a sibling acts; Diverge lanes work alone; settle disagreements with Split; build from the best answer; the parent decides, lanes report. Includes both the parent role and the lane role in a few lines each.
- `check.md`: the Check lane's prompt. Find what is wrong with this deliverable for this user; seams first for multi-part deliverables; report findings by severity with locations; do not rewrite the deliverable.
- `assembly` guidance lives in `guide.md` (an assembly lane is a Split lane with an assembly direction).

The recon nudge, wrap-up note, dormant-lane list and merge message are runtime notes appended through the run inbox or `appendPromptEnvelopeDelta` (after sealing), never in the prefix.

## 16. Tools

All schemas use strict function tools: every key in `properties` is in `required`; optional values use `["<type>", "null"]`.

| Tool | Who may call | Arguments | Effect |
|---|---|---|---|
| `split` | leader; lanes below max depth (not Check) | `lanes: [{ title, direction, weight: number\|null, model: string\|null*, effort: string\|null* }]`, `spine_path: string\|null` | Forks Split lanes, parks the caller. Must be the last tool call. |
| `diverge` | leader; Split lanes below max depth | `question`, `lanes: [{ title, direction: string\|null, model: string\|null*, effort: string\|null* }]` | Forks Diverge lanes, parks the caller. Adds an undirected lane if none. |
| `check` | leader; lanes that have children | `draft`, `files: string[]`, `focus: string\|null`, `model: string\|null*` | Starts a fresh Check lane, parks the caller. |
| `steer` | parent of the lane | `lane_id`, `message` | Appends to the lane at its next step. |
| `stop` | parent of the lane | `lane_id`, `discard: boolean` | Forced submit, or cancel and drop. |
| `resume` | parent of the lane | `lane_id`, `message`, `extra_tokens: number\|null` | Continues a dormant lane, parks the caller. |
| `share` | lanes | `text` | Adds a shared note for siblings. |
| `submit` | lanes | `summary`, `decisions: [{ choice, reason, would_change_if }]\|null`, `findings: [{ severity, location, issue }]\|null`, `files: string[]` | Ends the lane run with its result. `decisions` is expected from Diverge lanes, `findings` from Check lanes. |

`*` present only when the swarm has a router. `weight` is ignored when budgets are off. The summary is truncated to `laneSummaryMaxTokens`.

Removed tools: `assign_worker`, `swarm_pause`, `swarm_manage`, `swarm_budget_status`, `swarm_spawn_node`, `swarm_grant_budget`, `swarm_cancel_node`, `swarm_record_review`, `swarm_record_final_review`, `list_channels`, `read_channel`, `create_channel`, `send_channel_message`, `submit_swarm_output`.

`final_response` gating for swarms is replaced by the automatic Check intercept (section 11.7).

## 17. Web UI

### 17.1 Composer

As section 10.2. Replace swarm worker-count and roster controls in `TaskParametersDropdownContent.tsx` and `taskParametersDropdownController.ts` with: router, budgets switch and fields, and a collapsed Advanced section. Drafts in `taskInputDrafts.ts` store the new fields.

### 17.2 Task detail

- **Lane tracks**: under the leader message that started lanes, a compact block with one row per lane: title, kind, status, latest note, steps (and spent when budgets are on), an open button and a stop button. Sub-lanes nest under their lane. Notes stream in live.
- **Lane view**: opening a lane shows its conversation with the normal task detail renderer (lanes are tasks).
- **Dormant lanes**: a small list (title, one-line summary) available from the task header.
- **Conversation folding**: keep the existing "Worked for..." fold for a delivered turn; lane tracks and interim leader messages fold into it. Files and error notices stay visible.
- Remove the swarm parts of the workflow sidebar, strip, panels and channel popups.

### 17.3 Admin

Replace the swarm generator with plain fields in the preset editor: leader agent, router, budgets switch and fields, Advanced section. Delete `AgentSwarmGenerator.tsx`, `agent-swarm-generator.css` and `swarmGeneratorDraft.ts`. Add the outcome view (section 11.15) as a small table in the model settings area.

## 18. Code layout

Keep SRP strictly; one reason to change per file.

Worker, `apps/worker/src/services/agent-swarm/`:

| File | Responsibility |
|---|---|
| `config.ts` | Load the resolved swarm config for a run. |
| `lane-store.ts` | Lane rows: insert, status transitions, queries. |
| `fork-seed.ts` | Capture and store a fork seed from the current turn (section 13.1). |
| `lane-setup.ts` | The lane run setup path (section 13.2). |
| `fork-compaction.ts` | The shared compacted fork. |
| `park.ts` | Park a caller and consume park rows. |
| `barrier.ts` | Barrier check on child status change; enqueue the parent's resume. |
| `merge-message.ts` | Build the merge message (anonymize and shuffle for Diverge). |
| `scheduler.ts` | Start queued lanes within `maxRunningLanes`. |
| `recovery.ts` | Sweep for met barriers without runs. |
| `notes-store.ts` | Insert and claim notes by scope. |
| `auto-notes.ts` | Record grouped automatic notes from tool dispatch. |
| `notes-delivery.ts` | Append new notes before each request. |
| `forced-submit.ts` | The final forced `submit` call. |
| `check.ts` | Start Check lanes; the automatic intercept. |
| `dormancy.ts` | Dormant listing and expiry. |
| `budget.ts` | Charge, shares, wrap-up and exhaustion (only when enabled). |
| `model-route.ts` | Router picks for lanes. |
| `outcomes.ts` | Outcome fields on lanes. |
| `prompt.ts` | Swarm guide and runtime notes text. |

Tool handlers: one file per tool under `apps/worker/src/services/agent-tool-dispatch/handlers/swarm/`, plus role gating in `swarm/role-gate.ts`. Tool definitions in `agent-tools/function-tools.ts` and argument schemas in `agent-tools/argument-schemas.ts`.

API, `apps/api/src/services/agent-swarm/`: `settings.ts` (resolution), `creation.ts`, `lanes-read.ts`, `lane-stop.ts`, `legacy.ts`. Routes in `apps/api/src/routes/tasks/swarm-routes.ts`.

Shared: `packages/shared/src/agent-swarm-config.ts` (types, defaults, ranges, normalizer), mode union in `types.ts`.

## 19. Teardown

Delete or rewrite every current swarm code path. Files below were found by searching the repo; recheck with `grep -ril swarm` before finishing.

### 19.1 Delete

- Worker: `apps/worker/src/services/task-workflows/agent-swarm*.ts` (all, including tests and `agent-swarm.test-fixtures.ts`), `swarm-context.ts`, `swarm-guide-docs.ts`, `swarm-management-scope.ts`, `swarm-prompt-sections.ts`, `swarm-prompts.ts`, `swarm-target.ts` and their tests; `apps/worker/src/services/agent/swarm-budget-notes.ts`.
- API: `apps/api/src/services/tasks/agent-swarm-node-types.ts`, `agent-swarm-seeded-quota.ts`, `agent-swarm-task-creation.ts`, `agent-swarm-task-settings.ts`, `task-service/swarm-selection.ts`, and their tests.
- Shared: `packages/shared/src/agent-swarm.ts`, `agent-swarm-quota.ts`, and their tests (keep any budget limits still needed by moving them into `agent-swarm-config.ts`).
- Web: `pages/admin/settings/AgentSwarmGenerator.tsx`, `agent-swarm-generator.css`, `swarmGeneratorDraft.ts` (+test), `task/agentSwarmRosterSummary.ts`, `pages/task/detail/TaskWorkflowChannelPanel.tsx` (+test), `pages/task/detail/swarmAgentLabel.ts`.
- Prompts: `prompt-texts/agent-swarm/leader.md`, `worker.md` (replaced by `guide.md`, `check.md`).

### 19.2 Modify

- Worker agent loop: `agent/loop.ts` (remove swarm inbox delivery, reserve/settle, swarm pause and quarantine, `submitSwarmOutput`; add notes delivery, budget charge, forced submit, Check intercept), `agent/setup.ts`, `agent/prompt.ts`, `agent/runtime.ts`, `agent/execution-types.ts`, `agent/finalize.ts`, `agent/task-write-scope.ts`, `agent/turn-request.ts` (cache key), `agent/model.ts` (separate session affinity).
- Worker tools: `agent-tools/availability.ts`, `function-tools.ts`, `argument-schemas.ts`, `shared.ts`; `agent-tool-dispatch/dispatch.ts`, `types.ts`, `repeated-tool-calls.ts`, `readable-roots.ts`, `handlers/workflows.ts`, `handlers/scheduling.ts`, `handlers/wait.ts`, `handlers/project-master.ts`; `code-mode/tool-catalog.ts`, `code-mode-prompt.ts`, `code-mode-tools.ts`.
- Worker workflows (keep Long Horizon intact): `task-workflows/index.ts`, `context.ts`, `context-types.ts`, `shared.ts`, `prompts.ts`, `paths.ts`.
- Worker other: `notifications/web-push-dispatch.ts`, `project-master/task-agent.ts`, worker startup (register scheduler and recovery loops).
- API: `services/tasks/task-workflows.ts` (remove swarm creation, overview and channel reads), `task-workflow-transitions.ts`, `task-cancellation.ts` (cascade to lanes), `task-service/dispatch.ts`, `messages.ts`, `replacements.ts`, `runs.ts` (legacy rejection, swarm follow-ups), `spawned-tasks-sql.ts`; routes `admin-core-routes.ts`, `agents.ts`, `tasks/create-routes.ts`, `detail-routes.ts`, `schedule-routes.ts`, `shared.ts`, `workflow-routes.ts` (drop channel endpoints), `workspaces/settings-routes.ts`; `platform/platform-agents.ts`; `project-master/managed-tasks.ts`.
- Shared: `agent-presets.ts` (remove swarm compilation, `modelAllocations`, `reviewRounds`, `spawnableAsNode`, graph validation for nested swarms; add new fields), `index.ts`, `package.json` exports, `types.ts`, `task-history-archive.ts`, `task-history-search.ts`, `task-message-display-segments.ts`.
- Web: `components/tasks/TaskParametersDropdownContent.tsx`, `taskParametersDropdownController.ts`, `AgentDropdown.tsx`; `components/taskConversation/ChatInput.tsx`, `HistoricalConversationItems.tsx`; `components/settings/WorkspaceDefaultAgentSetting.tsx`; `lib/types.ts`, `lib/utils.ts`; `task/agentSwarmPresetWorkflow.ts`, `taskInputDrafts.ts`; `pages/admin/settings/adminSettingsDrafts.ts`, `ModelSettingsTab.tsx`; `pages/task/TaskComposerPage.tsx`; `pages/task/detail/TaskDetailConversationPane.tsx`, `TaskDetailWorkflowModals.tsx`, `TaskDetailWorkflowPanel.tsx`, `TaskDetailWorkflowStrip.tsx`, `TaskWorkflowOverviewPanel.tsx`, `TaskWorkflowSidebar.tsx`, `taskWorkflowSidebarTypes.ts`, `useTaskDetailWorkflowSidebar.ts`, `useTaskDetailComposer.ts`, `taskDetailMutations.ts`; `styles.css`, `styles/conversation.css`; `onboarding/generatedDocsManifest.ts`.
- Tests that reference the old swarm: update or delete alongside the code they cover (`agent-tool-dispatch/index.test.ts`, `agent-tools/index.test.ts`, `agent/loop.test.ts`, `task-workflows/prompts.test.ts`, API route and service tests, web component tests listed by the search).
- Docs and repo text: `README.md`, `AGENTS.md` (preset contract section), `apps/docs/docs/core-workflows/task-workflows.md`, `task-composer.md`, `task-follow-up.md`, `apps/docs/docs/index.md`, `introduction/principles.md`, `self-hosting/models-and-providers.md` (router and advanced settings), `promo-website/index.html`, `prompt-texts/personality/neural.md` if it mentions the old swarm. CHANGELOG only with permission.

## 20. Tests

Test behaviour, not prompt text.

- Fork identity: a lane's first request has the same tools array, prefix hash and conversation items as the parent's last request up to the lane's tool result; `prompt_cache_key` matches the parent's; `x-session-affinity` differs. A lane's second run (after parking for its own children) has the same prefix hash as its first.
- Parking: `split` ends the run with `swarm_wait`, writes a park row, and the parent is woken exactly once; the merge message is delivered once even if the resumed run is retried.
- Role gating: wrong-role swarm tool calls return tool errors; tools arrays are unchanged.
- Limits: fan-out, depth, running-lane cap (queued lanes start as others end), Diverge cannot diverge, Check cannot split.
- Barrier: parent resumes exactly once when the last child ends, including when a child fails or is stopped; recovery sweep enqueues a parent whose barrier is met without a run.
- Notes scope: siblings and ancestors only; Diverge lanes see no sibling notes until all siblings submit; delivery is append-only and skipped when empty.
- Forced submit at step limit, budget share, deadline and `stop`.
- Budgets: off by default; with budgets on, shares, wrap-up note once, exhaustion, reserve available to the leader, `resume` with extra tokens.
- Check intercept: holds the reply, starts a fresh lane without assistant reasoning, delivers the revised reply without a second automatic Check.
- Dormancy: resumable within `dormantLaneTurns`, expired after.
- Router: no router means no `model` parameter and root model; a pick is stored and used.
- Legacy: follow-ups on old swarm tasks return 409.
- Migration: run-kind and role constraints accept new inserts (`agent_swarm_lane`), old rows still valid, dropped tables gone.
- Settings resolution: request overrides preset, defaults, clamping, budgets off nulls budgets.
- Archive: a swarm with lanes and notes round-trips with IDs preserved.

## 21. Implementation order

1. **Teardown and schema**: migration, delete old code paths, legacy rejection, shared config types and preset contract. The app builds and runs with swarm presets creating plain leader tasks.
2. **Core lanes**: fork mechanics (including cache key and session affinity), Split, parking, barrier, merge message, notes (shared and automatic), forced submit, scheduler, recovery.
3. **Diverge, Check, resume**: decision records, anonymized merge, Check lane and intercept, dormancy, steer and stop.
4. **Router and budgets**.
5. **UI**: composer, lane tracks and lane view, admin preset editor, outcome view.
6. **Docs**: user docs and self-hosting docs; CHANGELOG with permission.

Run `npm run test`, `npm run lint` and `npm run build` after each phase.

## 22. Implementation notes

Details this doc left open, and how they were settled:

- **Steer, resume and stop** go through a lane inbox (`task_swarm_lane_inbox`, migration 141), claimed at the lane's next step boundary and appended through the run inbox. A `stop` entry turns the next request into the forced submit.
- **New lanes skip earlier notes.** A lane's note cursor starts at the swarm's latest note, since a fork already knows everything before it.
- **Diverge blindness.** A diverge lane with an active sibling receives notes in order up to the first sibling note and holds the rest until its siblings finish. Ancestors of a running lane are parked, so nothing they share waits behind it in practice. Anything below a diverge lane cannot diverge either.
- **Automatic Check runs once per user turn**: when lanes were created or merged since the user's last message and no Check lane was started since then. The reply after the findings is delivered as it is.
- **Check lanes** are fresh tasks with a seed that carries only the runtime (no history), get only `submit` as a swarm tool, are paid from the reserve rather than a share, and are not resumed. Their finding count is kept on the Check lane itself.
- **Shares.** The leader gives out the budget minus reserve, spend and what running lanes still hold. A lane gives out its share minus its spend and what it gave earlier, keeping the reserve fraction for its own merge. Given budget is not returned while a lane runs.
- **Dormancy** is computed from the conversation on read; lanes past it are marked `expired` when the leader's turn lists them, and all of a swarm's lanes expire when its history is archived.
- **Stops from the task page** use the same signals as the tool: an inbox stop for working lanes, the cancellation flag otherwise. The worker's swarm recovery ends flagged lanes that have no run and resumes their parent.
- **Lane tracks** are placed under the first leader message written after the lanes were created, which is the message that holds the fork call.


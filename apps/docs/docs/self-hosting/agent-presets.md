---
title: Agent presets
summary: Define model choices and defaults, including Agent Swarm settings.
---

# Agent presets

## Overview

An agent preset is a named model choice in the task composer. It combines a model ID with defaults such as reasoning effort. The provider supplies access to that model; the preset controls how people select and use it.

A standard preset runs one agent. An Agent Swarm preset starts from a standard leader preset and adds controls for splitting work across lanes. Presets supply defaults to the composer, where users can adjust task settings.

Configure the model connection first in [Models & Providers](./models-and-providers). The examples below belong in the agent preset editor in the Admin Panel, not the server's global JSON file.

## Standard presets

Each model in the task composer's picker is an **agent preset**: a name, a model ID, and settings such as reasoning effort. The wizard creates one preset per model you pick, and the first becomes `default`, which new tasks use.

To change presets later, open **Admin Panel → Model → Agent presets**. It's a JSON editor. Each preset looks like this:

```json
{
  "id": "default",
  "name": "GPT-5.5",
  "description": "Balanced defaults for most tasks.",
  "requiresSuperAdmin": false,
  "payload": {
    "model": "gpt-5.5",
    "responses": { "reasoning": { "effort": "medium", "summary": "auto" } }
  }
}
```

Leave out `responses.reasoning` for models that don't support reasoning. Presets can also define an [Agent Swarm](/core-workflows/task-workflows), described below.

### Agent Swarm presets

An Agent Swarm preset names a single-agent preset as its leader; the leader's lanes are copies of it. **Admin Panel → Model → Agent Swarm preset** edits these with plain fields and writes them into the presets JSON. Every setting below is also shown in the task composer, prefilled from the preset, so users can change it for one task.

```json
{
  "id": "research-swarm",
  "name": "Research Swarm",
  "description": "Splits big research across lanes.",
  "requiresSuperAdmin": false,
  "payload": {},
  "mode": "agent_swarm",
  "leaderAgentId": "default",
  "routerId": null,
  "spawnEffort": 3,
  "budgetsEnabled": false,
  "advanced": { "maxLanesPerParent": 8, "maxDepth": 2, "maxRunningLanes": 32 }
}
```

| Field | Default | Range | Meaning |
| --- | --- | --- | --- |
| `leaderAgentId` | required | a standard preset | The leader. Lanes run on its model unless a router pick says otherwise. Use a strong model. |
| `routerId` | `null` | a model router ID | Lets the leader pick each lane's model from the router's targets. Without one, every lane uses the leader's model. |
| `spawnEffort` | 3 (Balanced) | 1 to 5 | Convenience profile for delegation. 1 is Minimal and waits longer with smaller, shallower splits; 5 is Maximum and nudges earlier with wider, deeper splits. The profile scales the spawn-related Advanced values; it does not change budgets or `maxRunningLanes`. |
| `budgetsEnabled` | `false` | | Turns the shared token and time budget on. |
| `tokenBudget` | 10,000,000 when budgets are on | 1 to 100,000,000 | Weighted tokens shared by the leader and all lanes. |
| `timeBudgetMinutes` | none | 1 to 10,080 | When it runs out, lanes report what they have and the leader delivers. |
| `advanced.maxLanesPerParent` | 8 | 1 to 16 | Lanes any parent can run at once. |
| `advanced.maxDepth` | 2 | 1 to 3 | Lane levels below the leader; 1 turns off lanes splitting again. |
| `advanced.maxRunningLanes` | 32 | 1 to 128 | Lanes running at once across the swarm; the rest wait their turn. Keep it within your provider's rate limits. |
| `advanced.laneMaxSteps` | task setting | 1 to 500 or `null` | Steps per lane run. |
| `advanced.reconNudgeSteps` | 12 | 0 to 100 | Solo leader steps before it is reminded once that it can split; 0 turns this off. |
| `advanced.forkCompactionThresholdTokens` | 200,000 | 10,000 to 400,000 | Above this context size, lanes start from one shared compacted copy of the leader's conversation. |
| `advanced.laneSummaryMaxTokens` | 1,500 | 256 to 8,000 | Cap on the summary a lane reports. |
| `advanced.assemblyHintTokens` | 15,000 | 1,000 to 200,000 | When the parts lanes wrote are larger, the leader is told to join them in a separate lane. |
| `advanced.dormantLaneTurns` | 3 | 0 to 20 | User messages a finished lane stays resumable; 0 turns this off. |
| `advanced.autoCheck` | `true` | | A fresh reviewer checks replies on turns that used lanes. |
| `advanced.budgetReservePercent` | 15 | 5 to 50 | Part of the budget held back for putting the answer together and checking it. |
| `advanced.laneWrapUpPercent` | 80 | 50 to 95 | Share of its budget at which a lane is told to wrap up. |

Missing `advanced` fields use the defaults. The Advanced spawn values are the baseline for the Effort profile: the profile scales fan-out, depth and the recon nudge while leaving `maxRunningLanes` and budgets unchanged. A router pick that changes a lane's model gives up prompt caching for that lane, so routers are best used for the occasional independent reviewer or second opinion.

**Admin Panel → Model → Agent Swarm outcomes** shows, for each leader model, how many lanes its swarms start per turn, the mix of split, diverge and check lanes, how many lanes are stopped or fail, and how many problems Check finds. Use it to see whether a leader model splits work well.

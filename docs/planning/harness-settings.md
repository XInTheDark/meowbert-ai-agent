# Harness Settings: Planning & Specs

Status: Implemented. Section 19 records where the build differs from the original plan.

- Part I explains what we are building and why.
- Part II specifies the settings, who may change them, and how each one behaves.
- Part III lists code changes, milestones and tests.

For implementers: build it in the milestones of section 17, one per change. Where this doc names an existing function or pattern, extend it rather than adding a parallel mechanism. Where it leaves a detail open, pick the simplest option that keeps the invariants in section 15 and the AGENTS.md contracts (prompt caching, run-kind, filesystem cost), and record the choice in section 19.

---

# Part I: Planning

## 1. Summary

Harness settings are task-level controls over how the harness runs a task. Today the agent can only influence what happens inside a run. These settings let it, and the user, shape what happens between runs: whether the task wakes again after it answers, what must be true before it can finish, how much it may spend, and whether its sandbox survives between runs.

The settings:

| Setting | What it does |
| --- | --- |
| **Keep-alive** | The task keeps running until a deadline. When a run finishes, the harness starts the next one. |
| **Wake interval** | During keep-alive, how long the harness waits between cycles. |
| **Stop check** | A shell command that must pass before the task may finish. |
| **Budget** | A token cap for the task. |
| **Notify** | When the user gets notified. |
| **Warm sandbox** | The task's sandbox stays up for a while after a run ends, so the next run reuses it. |

The user sets them from the composer and the task header. The agent sets them with one tool, `harness_settings`, which is not loaded by default. Every run lists it as an on-demand tool group, and the agent loads it with `enable_skill` when it needs it.

Keep-alive is not a new loop. It is the existing **Timed task** (an `infinite` schedule with a deadline), which the agent can now start, extend or end on its own task.

## 2. What exists today

These are the pieces this design builds on. Read them before changing anything.

- **Timed tasks.** The composer's task parameters menu offers Scheduled, Infinite and Timed. A Timed task is a `task_schedules` row with `mode = 'infinite'`, `run_timeout_seconds` and a task-level `run_deadline_at` (`apps/api/src/services/tasks/task-schedule-config.ts`). Each cycle is an `infinite_auto` run. The agent ends a cycle with a time-only `wait` (60 s to 1 week), or the harness applies `DEFAULT_INFINITE_AUTO_WAIT_SECONDS` (300). At the deadline the running run is told to call `final_response` (`buildTimedRunFinalizationMessage`) and the schedule pauses (`pauseTimedScheduleAfterCompletion`). `final_response` is hidden during the window.
- **The scheduler loop.** `apps/worker/src/services/task-schedules/runtime.ts` (`processInfiniteDueTask`) starts due cycles, marks `pending_run` when the task is busy, and charges recurring-run entitlement.
- **Schedule tools.** `edit_current_task_schedule` edits cron, timezone and tool defaults. It cannot turn a standard task into a timed one. `schedule_task` creates new tasks.
- **On-demand tool groups.** `packages/run-executor/src/agent-tools/tool-groups.ts` defines groups (today only `task-scheduling`). `resolveOnDemandCapabilities` lists them in a stable setup delta, `withToolGroups` loads one when the agent calls `enable_skill` with its id, and the group's `description` is returned as the load result.
- **Run end hook.** `apps/worker/src/services/run-host/db-run-control.ts` calls `startRunForQueuedMessages` after every `complete()` and `fail()`. Queued user messages always win over any automatic continuation.
- **Run retries.** `apps/worker/src/services/tasks/task-run-retry.ts` retries a failed run with exponential backoff up to 15 minutes and `max_task_run_retries`. When retries run out the task is `failed` and a Timed loop stops.
- **Clarify timeout.** `apps/worker/src/services/task-workflows/clarify-timeout.ts` continues a Long Horizon task 15 minutes after its unanswered clarify question. It only covers Long Horizon.
- **Task time limit.** `tasks.time_limit_deadline_at` cancels the whole task at its deadline (`task-time-limit.ts`) and clears `run_deadline_at`.
- **Sandboxes.** Each run creates its sandbox lazily and stops it when the run ends (`sandbox-machine-host.ts`). Persistent shell sessions outlive runs, with a lifetime, a per-user slot limit (`persistentRuntimeLimit`) and compute credits. `runtime.sandbox.maxRunningContainers` caps sandboxes per Docker host, and orphan cleanup removes containers whose parent worker is gone.
- **Swarm budgets.** Agent Swarm already tracks `token_budget` and `spent_tokens` per swarm (`apps/worker/src/services/agent-swarm/budget.ts`).

## 3. Goals and non-goals

Goals:

- The agent can keep its own task alive for a bounded time, extend it and end it, within limits the user and the operator set.
- A user can set any of these settings when starting a task and change them while it runs.
- A task with a stop check cannot finish with that check failing, unless the agent has tried several times.
- A task waiting on an unanswered question does not stall a keep-alive window.
- A warm sandbox keeps background processes and installed packages between runs of the same task.
- The model knows exactly what each setting does, without the tool's schema costing context on runs that never use it.

Non-goals:

- A second looping mechanism next to Timed tasks.
- Keep-alive for swarm lanes, subagents or workflow child agents. A swarm task is already alive while its lanes run, so only root tasks get these settings.
- Keep-alive on cron-scheduled or Infinite tasks. Those are already recurring. The tool refuses there.
- The agent changing its own model or reasoning effort.

---

# Part II: Contracts

## 4. The settings

| Setting | Values | Default | Stored on |
| --- | --- | --- | --- |
| `keep_alive_until` | absolute time, or none | none | `task_schedules.run_deadline_at` (Timed) |
| `wake_interval_seconds` | 60 to 86400, or none | none (see 7.3) | `task_schedules.wake_interval_seconds` (new) |
| `stop_check` | `{ command, timeout_seconds }`, or none | none | `task_harness_settings` (new) |
| `token_budget` | positive integer, or none | none | `task_harness_settings` |
| `notify` | `on_finish`, `on_failure`, `never` | `on_finish` | `task_harness_settings` |
| `sandbox_keep_warm_minutes` | 1 to operator max, or none | none | `task_harness_settings` |

Every setting also records who set it last: `user` or `agent` (`*_set_by` columns).

New operator config under `harness` in `config/global.example.json`:

```json
{
  "harness": {
    "maxAgentKeepAliveMinutes": 240,
    "maxSandboxKeepWarmMinutes": 30,
    "maxStopCheckAttempts": 3,
    "maxFailedKeepAliveCycles": 3
  }
}
```

## 5. Who can change what

The user sets limits. The agent works inside them.

- **The user** can set, change or clear any setting at any time, from the composer or the task header.
- **The agent** can:
  - start keep-alive, or extend it, up to `maxAgentKeepAliveMinutes` from now, and never past the task time limit;
  - end keep-alive early only if the agent set it. A user-set keep-alive is a promise to the user and only the user ends it;
  - add, replace or clear the wake interval, stop check, notify setting or warm sandbox, but only while the user hasn't set that one;
  - lower a budget, never raise or remove it. A budget the agent lowers stays the user's if the user set it.
- The harness rejects a change outside these rules with a tool error that says why and what the current limit is, so the agent does not retry blindly.
- The agent can use `harness_settings` only on root tasks that are not read-only, not a Project Master and not Long Horizon, and whose tool options allow scheduling. Starting keep-alive counts against the recurring task limits. Keep-alive cycles charge recurring-run entitlement exactly as Timed cycles do today. If the user has no entitlement, the tool says so.

## 6. The tool

### 6.1 Loading

`harness_settings` lives in a new tool group, `harness-settings`, next to `task-scheduling` in `tool-groups.ts`.

- Every allowed root run lists the group in its on-demand capabilities. The listing is part of the stable setup delta, so it never breaks the prompt cache.
- When any harness setting is active at run start, the group is preloaded, the same way `task-scheduling` is preloaded for a task that already has a schedule.
- Loading the group returns a full **guide** (section 6.3), not just the one-line description. Extend the tool group record with an optional `guide` that `withToolGroups` returns as `doc` when present.

The one-line listing is what makes the model aware the tool exists:

> **Harness settings**: Keep this task running until a deadline, wake it on an interval, require a check to pass before it finishes, keep its sandbox warm between runs, or set a budget.

### 6.2 Schema

One strict function tool. Every key is required, and `null` means "leave unchanged", following the AGENTS.md rule for strict schemas. Zero or an empty string clears a setting.

```json
{
  "type": "function",
  "name": "harness_settings",
  "strict": true,
  "parameters": {
    "type": "object",
    "properties": {
      "keep_alive_minutes": { "type": ["integer", "null"], "description": "Keep this task running until this many minutes from now. 0 ends keep-alive. null leaves it unchanged." },
      "wake_interval_seconds": { "type": ["integer", "null"], "description": "During keep-alive, wait this long between cycles. 0 clears it. null leaves it unchanged." },
      "stop_check_command": { "type": ["string", "null"], "description": "Shell command that must exit 0 before the task can finish. Empty string clears it. null leaves it unchanged." },
      "stop_check_timeout_seconds": { "type": ["integer", "null"], "description": "Timeout for the stop check. null keeps the current value or the default of 600." },
      "token_budget": { "type": ["integer", "null"], "description": "Lower the task's token budget to this many tokens. null leaves it unchanged." },
      "notify": { "type": ["string", "null"], "enum": ["on_finish", "on_failure", "never", null], "description": "When the user is notified. null leaves it unchanged." },
      "sandbox_keep_warm_minutes": { "type": ["integer", "null"], "description": "Keep this task's sandbox running this many minutes after each run so the next run reuses it. 0 clears it. null leaves it unchanged." }
    },
    "required": ["keep_alive_minutes", "wake_interval_seconds", "stop_check_command", "stop_check_timeout_seconds", "token_budget", "notify", "sandbox_keep_warm_minutes"],
    "additionalProperties": false
  }
}
```

Calling it with every key `null` changes nothing and returns the current state, so the agent can read its settings without a second tool.

The result always returns the full current state: each setting's value, who set it, the absolute keep-alive deadline, the agent's limits (latest allowed keep-alive deadline, budget spent so far), and, for a rejected change, the reason. One rejected key does not apply any of the call's changes.

### 6.3 Guide for the model

Returned when the group loads. Keep it short and plain, per the AGENTS.md prompt rules. Draft:

> These settings change how the harness runs this task between your runs.
>
> **Keep-alive** keeps the task running until a deadline. While it is on, calling `final_response` delivers your answer and ends the current cycle, and the harness starts the next one after the wake interval. Each new cycle opens with a note saying how much time is left. Use the time to verify, improve or continue the work. If a cycle has nothing useful to do, end it quickly; the harness waits longer after idle cycles. You can end keep-alive only if you started it.
>
> **Stop check** is a command that must succeed before the task can finish. When it fails, your `final_response` is rejected with the command's output, and you keep working.
>
> **Warm sandbox** keeps your sandbox running between runs, so background processes and installed packages are still there next time. Files in the task and project folders persist either way.
>
> The user's settings are limits you work within. Changes you make appear in the task for the user to see.

## 7. Keep-alive

### 7.1 Model

Keep-alive is a Timed schedule. Turning it on for a standard task creates the `task_schedules` row the composer's Timed task creates today (`mode = 'infinite'`, `run_deadline_at = now + minutes`, `run_timeout_seconds` set), with `keep_alive_set_by`. Extending moves `run_deadline_at`. Ending it pauses the schedule right away; the current run finishes normally. Share the row-writing code with the API's `task-schedule-config.ts` and `schedule-routes.ts` rather than writing a second copy in the worker.

There is no new run kind. Cycles stay `infinite_auto`, so the run-kind contract is unaffected.

### 7.2 Ending a cycle with `final_response`

Today `final_response` is hidden during a Timed window. That has to change, for two reasons:

- The agent turns keep-alive on in the middle of a standard run. Removing `final_response` from the tool list then changes the cached prefix in the middle of a run.
- The model you'd expect: the agent answers, and the harness wakes it again.

New rule: in a keep-alive task, `final_response` is always available. Inside the window it ends the cycle: the response is appended and delivered like any answer (notifications per `notify`), and the schedule's `next_run_at` is set as in 7.3. A time-only `wait` keeps working as it does today. At the deadline, the existing finalization message runs and the final `final_response` ends the task.

This changes the composer's Timed tasks too. That's intended: there is one loop, and it behaves one way.

### 7.3 Delay between cycles

- With a wake interval: `next_run_at = now + wake_interval_seconds`.
- Without one: 60 seconds.
- **Idle backoff.** A cycle is idle when it called no tools other than `final_response`, `wait`, `send_message` and `harness_settings`. Each consecutive idle cycle doubles the delay, up to 30 minutes, or the wake interval if that is longer. The first non-idle cycle resets it. Store the count in `task_schedules.idle_cycle_count`.
- An explicit `wait` from the agent overrides the computed delay for that cycle.

### 7.4 Each cycle's opening message

The scheduler opens each cycle with a short system message in the conversation, not in the prompt prefix: why it woke (interval, after a failure, after an unanswered question), and time left against the absolute deadline. This keeps per-cycle state out of the cached prefix.

### 7.5 Failed runs

Failed runs count, as decided: they do not end keep-alive.

- Retries inside a cycle work as today (`task-run-retry.ts`).
- When retries run out inside a keep-alive window, `failServerRun` still records the failure in the conversation, but instead of leaving the loop dead it increments `task_schedules.failed_cycle_count` and schedules the next cycle with the same backoff curve as retries (capped at 15 minutes). The task status goes back to `queued` for the next cycle rather than staying `failed`.
- After `maxFailedKeepAliveCycles` consecutive failed cycles, the schedule pauses, the task is `failed`, and the user gets a push notification unless `notify` is `never`.
- A successful cycle resets the count.

### 7.6 Interactions

- **User messages** win. A queued message starts its run through the existing after-run hook, and the scheduler marks `pending_run` because the task is busy, as today.
- **Cancel and the task time limit** win. Both already clear `run_deadline_at`. The tool never sets a deadline past `time_limit_deadline_at`.
- **Questions.** `request_clarification` puts the task in `awaiting_input`, and keep-alive does not wake it. Long Horizon keeps its own clarify timeout.
- **Swarm root.** A swarm root may use keep-alive. Its lanes may not, and the tool is not offered to them.
- **Long Horizon.** Not offered in v1; Long Horizon has its own phases. See section 19.

## 8. Stop check

- Runs when the agent calls `final_response` and the task has a stop check, including at a keep-alive cycle end and at the deadline. Hook it where `loop.ts` accepts `dispatchResult.finalResponse`.
- The command runs in the task's sandbox, in the task directory, through the same exec path as the agent's shell tool, with its timeout (default 600 s).
- **Exit 0**: the response is accepted.
- **Non-zero or timeout**: the `final_response` call returns an error with the exit code and the tail of the output, and the run continues. Nothing is delivered.
- After `maxStopCheckAttempts` rejected attempts in a row, the next `final_response` is accepted with a visible note that the check is still failing, so a task never loops forever on a check it cannot pass. At the keep-alive deadline, the same applies to the single finalization attempt.
- Each check run appears in the transcript as a compact tool row so the user sees it ran.
- Read-only tasks cannot have a stop check.

## 9. Ask timeout

Dropped. Standard tasks never wait in `awaiting_input` for long, so the setting had nothing to act on. Long Horizon keeps `clarify-timeout.ts` as it is.

## 10. Budget

- `token_budget` caps total tokens across the task's runs. The user sets it; the agent can only lower it.
- Track spend in a counter on the task (`tasks.spent_tokens`). While a budget is set, each model turn's tokens are added right away, so failed and cancelled runs count; otherwise the run adds its total when it finishes. Do not sum usage events on each check.
- At run start and after each model turn: if spent reaches the budget, the run gets a finalization message like the Timed deadline's and must call `final_response`. Keep-alive ends.
- Swarm budgets stay as they are. A swarm root with both uses whichever runs out first.

## 11. Notify

- `on_finish` (default): today's behavior. Answers notify; failed runs don't.
- `on_failure`: answers don't notify; each failed run sends a push notification.
- `never`: none, except the forced notification in 7.5.
- Applies to `final_response` deliveries, cycle ends and the existing `wait` `notify` flag (the setting wins over the flag when the user set it).

## 12. Warm sandbox

### 12.1 Behavior

When a run ends and `sandbox_keep_warm_minutes` is set, the sandbox is not stopped. It stays up until `run end + minutes`. The next run of the same task adopts it if it starts before then; otherwise it is stopped.

What survives: running processes (dev servers, watchers, shell sessions started inside the sandbox), the container's writable layer (installed packages, caches outside mounted folders), and source mounts. Files in task and project folders persist without this setting.

### 12.2 Mechanism

- **Parking.** `startSandboxMachine`'s `stop` reads the setting when the run ends. If it is set, the controller detaches the sandbox without stopping it, and `warm-sandboxes.ts` keeps its handle in the worker process with an expiry timer. A `task_warm_sandboxes` row records the container, task, user and expiry. Docker labels can't change after a container is created, so the row, not a label, marks it warm.
- **Adoption.** At run start, the provider asks the same worker process for the task's parked sandbox. It is adopted when it hasn't expired, was created for the same user with the same network, root and read-only options, and its crash report reads clean (a failed read counts as unhealthy). Otherwise it is stopped and a new one is created. The container still carries the label of the run that created it, so adoption records the new run in the row's `adopted_by_run_id`, and orphan cleanup keeps the container until that run ends.
- **Expiry.** The expiry timer stops the sandbox and releases its source mounts. Each orphan cleanup pass drops rows that expired, belong to a cancelled or trashed task, or whose setting was cleared, and stops this worker's parked sandboxes whose row is gone. Orphan cleanup skips a running container with a live row, unless its parent worker is gone (then nothing holds its handle).
- **Capacity.**
  - A warm sandbox holds a slot under `maxRunningContainers`.
  - When a new sandbox waits for a slot, the oldest warm sandbox is stopped first. Warm sandboxes are the lowest priority.
  - Warm sandboxes count toward the user's `persistentRuntimeLimit`, the same per-user limit as persistent shell sessions. If the user is at their limit, the sandbox is stopped normally and the run's end notes why.
- **Other workers.** Only the worker process that parked a sandbox holds its handle. If the next run lands on another worker, it creates a new sandbox and the warm one expires on its own.
- **Local execution.** Works the same on the desktop's Docker. Host mode has no sandbox, so the setting does nothing there and the tool says so.
- **Cancel or trash.** The next orphan cleanup pass (every minute) stops the warm sandbox, since those paths run in the API.

## 13. Prompt and caching

Per the prompt caching contract in `prompt-envelope.ts`:

- The tool group listing is part of every allowed run's stable setup delta.
- When settings are active at run start, a setup delta with reason `harness-settings` states them using absolute times (for example "keep-alive until 2026-11-22 18:40 UTC, set by the user"), never "N minutes left". It is identical across runs until a setting changes.
- A change during a run is a queued delta with the same reason, so it supersedes the earlier one at the tail.
- Per-cycle state (time left, why it woke, idle or failed counts) goes only in the cycle's opening message (7.4).
- The tool list never changes because of keep-alive (7.2).
- Today a Timed task gets its Infinite Auto completion section in the base system prompt. For keep-alive tasks, move those rules into the `harness-settings` delta and the guide, so a standard task that turns keep-alive on keeps its prefix. Infinite tasks keep their current section. Existing Timed tasks see one prefix change on deploy.

## 14. UI

- **Composer.** The task parameters menu keeps **Timed task** as the way to start keep-alive. **Edit parameters** gains **Stop check**, **Token budget** and **Keep sandbox warm (minutes)**. Nothing new goes above the input, per AGENTS.md.
- **Task header.** Keep-alive uses the existing schedule chip. Its menu gains **+1 h** next to **Stop timed run** (End now), a **Kept alive by** row, and rows for an active stop check, token budget or warm sandbox. A user edit to a Timed schedule makes the keep-alive the user's.
- **Transcript.** Each agent change shows as the `harness_settings` tool row with the keys it changed, so the user sees what the agent did to their task.
- **API.** Extend the existing task parameters patch (`apps/api/src/routes/tasks/shared.ts` and `schedule-routes.ts`) with the new fields rather than adding a separate route.

## 15. Invariants

1. User cancel, the task time limit and user messages always win over keep-alive.
2. The agent never loosens a limit the user set, and never ends a keep-alive the user set.
3. Keep-alive is always bounded: by its deadline, the task time limit, the budget and the failed-cycle cap.
4. A task never loops forever on a stop check.
5. Settings never put per-run state in the cached prefix, and keep-alive never changes the tool list.
6. A warm sandbox is always bounded by `warm-until`, always counted against capacity and the user's runtime limit, and evicted first under pressure.
7. Swarm lanes, subagents and workflow child agents never get these settings.

---

# Part III: Implementation

## 16. Code changes by area

**Migrations** (new numbered migration):
- `task_schedules`: `keep_alive_set_by`, `wake_interval_seconds` and `wake_interval_set_by`, `idle_cycle_count`, `failed_cycle_count`, `last_wake_reason`.
- New `task_harness_settings(task_id pk references tasks on delete cascade, stop_check_command, stop_check_timeout_seconds, token_budget, notify, sandbox_keep_warm_minutes, each with a *_set_by, updated_at)`.
- `tasks.spent_tokens bigint NOT NULL DEFAULT 0`.
- New `task_warm_sandboxes(container_id pk, task_id, user_id, expires_at)`, plus `adopted_by_run_id` in migration 171 (section 12.2).
- Include `task_harness_settings` in cold archive and restore if it ends up holding anything beyond these scalars.

**Shared** (`packages/shared`): settings types, ranges, normalizer, the authority rules from section 5 as one pure function (`applyHarnessSettingsChange(current, change, actor, limits)`), and config schema for `harness`.

**Run executor** (`packages/run-executor`):
- `agent-tools/tool-groups.ts`: the `harness-settings` group with `guide`; `withToolGroups` returns it.
- `agent-tools/function-tools.ts` and `argument-schemas.ts`: the tool.
- `agent/setup.ts`: allow and preload the group (section 6.1), keep `final_response` for keep-alive tasks.
- `agent/loop.ts`: cycle end on `final_response` inside a window; stop check before accepting `final_response`; budget finalization.
- `agent/prompt.ts`: move keep-alive completion rules out of the base prompt (section 13).
- A platform tool host method for `harness_settings`, so it goes through the Run API like the schedule tools.

**Worker** (`apps/worker`):
- `run-host/platform-tools.ts` and `run-api/call-handlers.ts`: handle the tool, validate with the shared function, write rows, emit the transcript row.
- `task-schedules/`: next-cycle delay and idle backoff; cycle opening message.
- `run-host/run-failure.ts`: failed-cycle handling (7.5).
- `run-host/sandbox-machine-host.ts`, `packages/shared/src/docker-sandbox*.ts`, `tasks/sandbox-orphan-cleanup.ts`: parking, adoption, expiry, eviction (section 12).
- `platform.addTaskSpentTokens`: increment `spent_tokens` (section 10).

**API and web**: task parameters patch fields; composer **Edit parameters** fields; task header timer chip and menu.

**Docs**:
- User docs: extend `core-workflows/scheduled-tasks.md` (keep-alive, wake interval, final_response behavior in Timed tasks) and add a short page for stop check, budget and warm sandbox under Tasks.
- Self-hosting: the `harness` config block and how warm sandboxes count against capacity.

## 17. Milestones

1. **Keep-alive from the agent.** Tool group with guide, tool with keep-alive and wake interval only, authority rules, `final_response` as cycle end, idle backoff, cycle opening message, failed cycles, prompt changes, header chip. This is the core of the feature.
2. **Stop check.**
3. **Warm sandbox.**
4. **Budget and notify.**

## 18. Tests

Test behavior, not prompt text (AGENTS.md):

- Authority: the agent cannot end a user-set keep-alive, raise a budget, or extend past `maxAgentKeepAliveMinutes` or the task time limit; a rejected key applies nothing.
- The tool is not offered to lanes, subagents, read-only tasks or tasks without scheduling allowed; it is preloaded when a setting is active.
- A standard task that turns on keep-alive gets a next cycle after `final_response`; the tool list is the same before and after.
- Idle backoff doubles and resets; an explicit `wait` overrides it.
- A run that fails after retries schedules the next cycle; the configured number of consecutive failures pauses the schedule and fails the task.
- Queued user messages, cancel and the task time limit stop or preempt cycles.
- A failing stop check rejects `final_response` and the run continues; the attempt cap accepts with a note.
- A parked sandbox is adopted by the next run, expires on time, survives orphan cleanup while warm, is evicted first under capacity pressure, and is refused at the user's runtime limit.
- Budget finalization triggers when spend reaches the budget.

## 19. Open questions and decisions

Decided:

- Keep-alive builds on Timed tasks; no separate mechanism.
- Root tasks only.
- Failed runs do not end keep-alive (7.5).
- Warm sandboxes are in scope (section 12).
- The tool loads on demand and is listed in every allowed run's prompt; its guide is returned on load.
- `final_response` is available in every Timed task (it was already in the tool list; only its acceptance changed).
- Ask timeout is dropped (section 9).

Where the build differs from Part II:

- **Run notice instead of a settings delta.** Active settings, time left and the wake reason go in one `[System: ...]` note at the start of each run, in the conversation. Nothing is added to the setup deltas, and the Infinite Auto prompt section stays as it is.
- **Agent authority** is simpler than the first draft of section 5: the agent can't replace or clear any setting the user set, and can only lower a budget.
- **Lanes** are refused in the tool handler as well as by tool availability.
- **One store, two callers.** `packages/shared/src/harness-settings-store.ts` holds the reads, writes and rules. The API applies user changes from the task parameters patch and task creation; the worker applies the agent's through the Run API.
- **Warm sandboxes** are adopted only by the worker process that parked them (section 12.2).

Open:

- **Long Horizon.** Allow keep-alive on a Long Horizon root after it is approved? Not in v1.
- **Warm sandbox credits.** Count warm minutes against persistent runtime compute credits as well as the slot limit, or only the slot limit? Recommendation: slots only in v1, since warm time is bounded by `maxSandboxKeepWarmMinutes`.
- **Notify for keep-alive cycles.** Should a cycle end notify by default, or only the final answer? Recommendation: only when the cycle's response is not idle.

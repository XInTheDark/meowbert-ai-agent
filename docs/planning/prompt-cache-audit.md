# Prompt cache stability audit

Updated October 30, 2026. Scope: request assembly, run resumes, idle compaction,
provider normalization, tool catalogs, and context persistence in Meowbert.
Findings are based on local source and request comparisons, not production
cache telemetry. Meridian's local Responses translator was inspected read-only.

## Cache contract

Within a context window, the effective provider prefix should remain unchanged
and the conversation should grow by appending items. A run boundary, private
note write, temporary device disconnect, or bookkeeping turn should not rewrite
earlier input. A new context window, explicit history edit, or model/provider
change can require a new prefix. Permission changes must take effect immediately;
cache preservation must never restore revoked capabilities.

The contract applies after provider normalization. Equality of Meowbert's
`promptPrefixHash` alone does not establish equality of the provider's prefix.
Meridian promotes leading developer messages from `input` into its system prompt;
Google normalization also transforms instruction messages.

## Implemented: private notes changed the opening prompt

`setup.ts` prepends `buildV2WindowDeveloperItems` on every ordinary or idle run.
Previously that function rebuilt the opening hint from current continuity notes,
note sizes and update times. Note writes during a run therefore changed the
leading developer message when the same window resumed. Meridian folded the
changed message into its system prompt, ahead of the cached history.

Migration 154 adds `task_context_windows.opening_prompt_json`. The context store
atomically preserves the first opening prompt for each window and returns that
snapshot on later runs. New windows take fresh snapshots; notes remain current
through their tools. The snapshot crosses the Run API and cold archive/restore
boundaries. Ownership checks bind it to the task. Existing windows initialize
once after the migration; their original unsaved opening hint cannot be recovered
from this column retroactively.

Verification covers normal-to-idle request prefix equality after note changes,
new-window refresh, restart/reference isolation, PostgreSQL first-writer races,
task ownership, lost Run API replies, and archive restoration. PostgreSQL tests
use `TEST_CONTEXT_DATABASE_URL` and create an isolated schema. No live model cache
measurement is claimed.

## Follow-up implementation status

Migration 155 adds an atomic per-window request snapshot. The first effective
prompt envelope is retained on resumes; changed current setup is delivered in a
persisted developer item at the conversation tail. This covers memory, outline,
source-status, canvas metadata, schedule and initial capability documentation.
Rollover may adopt the current setup into a fresh snapshot. Forked swarm lanes
continue using their existing seed envelope and session-isolation mechanism.

Idle requests reuse the last ordinary tool recipe and tool choice, intersected with currently
available tools. Code-mode exec documentation is rebuilt from that intersection,
so incidental idle scheduling tools do not change it and revoked sources do not
come back. Ordinary completion tool schemas and consented computer tools remain
stable across timed phases and temporary disconnects; dispatch enforces current
completion eligibility, tool authorization and device readiness. A stable recipe
does not grant permission to execute a removed tool.

All queued prompt notes, including temporary run guidance, are persisted.
Winding-down and retry/fallback notices and workflow live state are also saved in
their original order. A new run supersedes an earlier timed-wrap-up instruction
at the tail. Google merges leading instructions only and carries later notices
as user-role conversation items while preserving tool-output adjacency.

The snapshot is transported through the Run API and included in cold archives.
Unchanged turns reuse the in-process snapshot without another database write;
ordinary tool changes update the stored recipe. PostgreSQL races and ownership,
lost replies, archive restoration, setup changes/reverts/restarts, rollover,
normalized Google prefixes, idle code-mode catalogs and revocations are covered
by regressions. Existing windows initialize once after migration 155; no original
unsaved setup can be reconstructed retroactively. Migrations 154 and 155 must be
applied before the updated runtime starts. Live provider cache usage is untested.

Remaining work: direct tool additions or transient source-discovery failures can
still change ordinary request schemas (finding 6); quick-mode sandbox activation
also changes its capabilities. The cache/session digest redesign (finding 7) is
still proposed. Google role handling is verified locally, not against a live
proxy/model. Broader V1 setup persistence remains outside this V2 window fix.

## Findings and original proposed fixes

Findings 1–5 are addressed by the follow-up above for V2 windows; finding 6 is
partially addressed through immutable setup and idle tool replay. The source
descriptions below record the failure paths identified before those changes.

### 1. Mutable state in the base prompt and setup deltas

Sources:

- `packages/run-executor/src/agent/prompt.ts`: embeds workspace/project
  `MEMORY.md` contents, canvas attachment details, recurring schedule state,
  live-source errors and project-context listings.
- `packages/run-executor/src/agent/runtime.ts`: reloads memory on run startup.
- `packages/run-executor/src/agent/conversation-organization.ts`: includes
  `outline_exists` and `map_exists` in the setup prompt.
- `packages/run-executor/src/agent/setup.ts`: inserts these into the prefix
  before the first request of every run.

Local request comparisons confirmed that changing memory content, creating an
outline, or changing only a source's sync error changes both the prefix and cache
key while tools remain identical. Creating a canvas can additionally auto-enable
its skill. This has the same failure shape as the private-notes bug.

Proposed fix: persist the initial effective setup prefix per window, including
its base prompt and initial capability documentation. Deliver current memory,
organization, source, canvas and schedule state as persisted tail updates or tool
results. Regenerate the snapshot on rollover. Avoid freezing authorization or
using stale permission decisions from a saved prompt.

### 2. Recurring task mode changes during idle compaction

Sources: `agent/setup.ts` (`buildRunSystemPrompt`), `agent/loop.ts`
(`resolveStepAvailability`), `agent/runtime.ts` (`resolveRunToolOptions`).

An `infinite_auto` run omits `final_response` and uses an infinite-mode completion
prompt. The idle job has mode `compact_only`, so it reconstructs ordinary
completion instructions and exposes `final_response`. Scheduled/infinite runs
also disable scheduling tools, whereas `compact_only` does not apply that rule.
A local comparison confirmed that the infinite-to-idle transition changes the
prefix, tools and cache key before the extra bookkeeping request. Timed wrap-up
similarly adds/removes completion tools during the active window.

Proposed fix: save and reuse the previous request's authorized prompt/tool recipe
for the first idle turn. Enforce idle notes-only behavior in dispatch, as today.
Keep completion tool definitions stable during ordinary/timed runs and enforce
current action eligibility at execution time. Explicit revocations still remove
access immediately, even if the resulting cache break is unavoidable.

### 3. Google normalization moves tail instructions to the front

Source: `agent/provider-request-input.ts` (`mergeGoogleInstructionMessages`).

It extracts every system/developer item, including those appended after user
messages, into one leading system message. A local comparison confirmed that
appending only a developer note changes the system message while ordinary
history is otherwise unchanged. Budget reminders, skill updates and the idle
instruction can all take this path.

Proposed fix: merge only leading instruction items. Preserve later runtime
notices at their conversation position using the provider-supported role, as
Meridian's current Responses translation does. Test normalized request prefixes,
then verify the actual Google proxy/model path. Preserve tool-result adjacency.

### 4. Device readiness changes both setup and tools

Sources: `agent/loop.ts` (`appendComputerAvailabilityPrompt`),
`agent-tools/availability.ts` (`isToolEnabled`).

The first step places current device availability, failure reason and display
dimensions into the unsealed prefix. Later steps append notices, but the next
run builds its prefix afresh. A disconnect, reconnect, display change or changed
reason can therefore rewrite setup; readiness also adds/removes computer tools.

Proposed fix: keep static device instructions and the consented tool schemas
stable for the window. Append persisted readiness/display observations and check
actual readiness when executing an action. Consent revocation remains a hard
runtime boundary, distinct from temporary unavailability.

### 5. Run-scoped messages disappear from replay

Sources: `agent/setup.ts` (quick-mode transition and timed finalization),
`agent/queued-prompt-deltas.ts` (excludes `runScoped` items from persistence).

These messages can enter the conversation after the prefix is sealed and be
followed by model/tool turns. On resume, their original positions disappear.
Quick-mode setup may instead recreate capability documentation in the prefix.
Even identical text moved to a different position does not preserve replay.

Proposed fix: persist every item actually sent within an active window. Append
a new run-state update to supersede expired instructions; do not remove old
observations. Expire state through runtime checks and new tail instructions.

### 6. Capability documentation and catalogs rebuild at run boundaries

Sources: `agent/run-capabilities.ts`, `agent/skill-prompt.ts`,
`agent/turn-request.ts`, `code-mode/tool-catalog.ts`.

Restored skills generally recover their tools without duplicating history.
Code mode also deliberately excludes on-demand skills/groups from its fixed
catalog, which preserves the prefix when those load. However, selected skills
and sources are re-read into setup on every run; changed docs, tool names,
ordering or a transient discovery failure can change the prefix. Non-code-mode
skill/tool additions change the tool schema array immediately.

Proposed fix: preserve initial capability documentation and catalog ordering per
window. Rehydrate tool implementations separately. Persist capability additions
as tail events; use code-mode discovery where practical. If direct provider
tools must change, record that as an explicit catalog transition rather than
silently losing the previous recipe. Never retain removed source authorization.

### 7. Cache/session keys follow internal frame metadata

Sources: `agent/prompt-envelope.ts` (`computePromptPrefixHash`),
`agent/turn-request.ts` (`buildPromptCacheKey`),
`agent/model.ts` (normalization), `agent/chatgpt-request.ts`.

The key hashes internal frame IDs, roles and version metadata before provider
normalization. ChatGPT Codex flattens roles into instruction text. A local probe
with equivalent flattened instructions produced different keys solely from a
system/developer role difference. Conversely, the original V2 notes bug changed
Meridian's system prompt without changing Meowbert's reported prefix hash.

Proposed fix: distinguish stable conversation/window identity from a diagnostic
digest of the actual normalized provider prefix. Exclude non-wire metadata from
the latter. Validate session-key changes against Meridian's append-only session
contract and fork isolation; do not simply switch all sessions to task IDs.

## Recommended order

1. Persist the complete effective per-window setup recipe and faithfully replay
   every sent item. This addresses mutable setup and run-scoped replay together.
2. Make idle compaction inherit that recipe, including recurring-task tools.
3. Fix provider normalization so tail updates remain tail updates.
4. Separate transient readiness/action eligibility from schema presentation,
   with authorization enforced on every execution path.
5. Add normalized-prefix diagnostics and append-only regressions around the
   first request after each ordinary resume, idle wake and restart. Classify
   intentional rollover/history-edit/model changes separately.

Direct capability/catalog transitions and normalized cache diagnostics remain
separate follow-ups as described above.
Existing `context_replace_calls`, manual history edits and context rollover
deliberately replace input and are separate from these accidental mutations.

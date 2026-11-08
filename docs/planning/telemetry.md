# Product telemetry

Status: proposal, 2026-11-08. No telemetry is implemented by this document.

## Overview

Measure adoption, installation size, version uptake, and feature usage through one small daily report per installation. Build aggregates inside the installation; send counts, fixed histogram buckets, and approved product categories. Do not send account identities, workspace/project/task identifiers, or their contents.

Use PostHog for storage, queries, and dashboards. Send reports with Node's native `fetch` and validate them with the existing Zod dependency; an analytics SDK is unnecessary for this volume. PostHog supports HTTP event capture without person profiles. Keep a small Meowbert-operated collector in front of it to enforce the schema and avoid forwarding installation IPs or request headers to the analytics provider.

```text
Installation PostgreSQL -> daily API reporter -> Meowbert collector -> PostHog dashboards
            ^
     aggregate feature counters from API/worker
```

The collector is operated centrally, not added to every self-hosted deployment. Do not add browser tracking, cookies, pageview capture, session replay, or a separate telemetry daemon. Runtime measurements are collected at existing operation boundaries, not by reading logs or conversation histories.

## Control and transparency

Proposed default: enabled for production deployments, disabled in development and tests. This is an explicit opt-out design assumption for review. The deployment switch is:

```env
MEOWBERT_TELEMETRY_DISABLED=true
```

- Accept `true` or `1` to disable; an invalid explicit value disables telemetry and logs a local configuration warning. An unset value follows the deployment default.
- Disabling takes precedence over configuration JSON. It prevents telemetry counters, report creation, retries, and all telemetry network requests in API and worker processes. Discard unsent reports when the disabled deployment starts; do not upload disabled-period history on re-enable. Existing operational records remain operational records.
- On re-enable, activity windows start at the new enable timestamp and remain marked partial until their full window has elapsed; do not count operational `last_seen_at` records from the disabled period. Structural snapshots describe the current installation, not a replay of past actions.
- Pass the variable into API and worker containers; changing the deploy environment takes effect after restart/redeploy. Regenerate the Coolify compose file after compose changes.
- At startup, log whether telemetry is enabled, its destination, and how to disable it. Document the complete schema, a sample report, retention, and the switch in the self-hosting guide. Provide an administrator-only way to preview the exact outbound report.
- Show a concise disclosure in administrator setup and release/upgrade documentation before reporting begins. Setup must not silently enroll an administrator who has not had the opportunity to disable collection. Do not describe opt-out telemetry as universally acceptable: some operators object to any default-on collection. Offer the same installation with telemetry fully disabled, without reduced functionality.

## Identity and version

- An installation is one logical Meowbert database, identified by a randomly generated telemetry-only UUID persisted atomically in PostgreSQL. All API/worker replicas share it. Never derive it from a hostname, URL, email, IP, database credentials, or machine fingerprint.
- Upgrades and restores retain the UUID. Independent clones must explicitly reset it; deleting/recreating the database creates a new installation. These limits are documented rather than hidden behind fingerprinting.
- Supply official release/build metadata during packaging. Current root/API package versions (`1.0.0` / `0.1.0`) do not provide a shared server build identifier. Send an official release identifier and build channel; classify unrecognized builds as `custom`, without branch names or arbitrary version strings.
- Measure server installations separately from clients and execution devices. A desktop connecting to multiple servers does not create more server installations on its own, and client operation counts are not unique device/person counts.

## Module boundaries

Telemetry owns its schemas, classification, aggregation, storage, and delivery. Keep domain operations responsible for their existing behavior, with narrow typed observations at operation boundaries. Do not sprinkle HTTP calls, report assembly, or arbitrary analytics property objects through task/model handlers.

| Module | Responsibility |
| --- | --- |
| `packages/telemetry` (`@meowbert/telemetry`) | Pure report/observation types and strict schemas, the disable gate, fixed catalogs, safe model/error classifiers, histogram/reducer logic, and bounded in-memory buffering. Split files by those responsibilities. No imports from API, worker, desktop, PostgreSQL, or PostHog. |
| `apps/api/src/services/telemetry` | Installation state, database snapshot/counter adapter, reporter lease/outbox, daily report assembly, and HTTP delivery. Separate persistence, collection, and transport files. Startup/shutdown wiring only in the API entry point. |
| `apps/worker/src/services/telemetry` | Small adapter for flushing typed aggregate observations from hosted execution. Reuse the package's reducer/gate rather than implementing separate privacy rules. |
| Run executor observation port | Optional typed sink for model-attempt, run-summary, and context-action observations. A no-op when disabled. The server-side adapter consumes local/proxied execution observations through the existing Run API; do not add a desktop analytics endpoint or bypass the server switch. |
| `apps/web/src/telemetry` | A tiny surface classifier returning only approved enums for existing task-action requests. No SDK, timers, persistent IDs, or analytics network destination. |
| `apps/telemetry-collector` | Centrally operated ingestion validation, deduplication/installation registry, retention/deletion, and forwarding to PostHog. Excluded from the self-hosted compose stack. |

The API owns periodic reporting. The worker and executor never send directly to the external collector. Choose one authoritative observation source for each model attempt/run so the model proxy, worker, and desktop cannot count the same operation twice. Reuse existing run-control channels for the small final summaries; respect their fencing and completion contracts. Internal IDs may be used locally for deduplication, but the aggregate serializer cannot accept or export them.

Provide focused calls such as `observeModelAttempt`, `observeRunFinished`, and `observeContextAction` with typed scalar inputs. They accept neither prompts/tool arguments nor entire request, response, or error objects. Classification happens locally in the responsible adapter, before buffering. No generic event bus, catch-all utilities file, or `track(name, properties)` interface. Keep tests beside each responsibility and domain changes limited to those hooks.

## Metrics

Use one strict, versioned `installation_daily` report containing a random installation UUID, immutable report UUID, UTC reporting date, collection time, approved build metadata, and the following aggregates. A first report can contain a current snapshot; activity counters start from telemetry enablement, with partial-day coverage marked explicitly.

| Question | Collected values and definition |
| --- | --- |
| How many installs? | Distinct reporting installation UUIDs ever observed, newly first-seen installs, and installations reporting in the last 7/30 days. Reporting availability and actual account/task activity are separate measures. |
| How many users? | Registered accounts and unique accounts with authenticated activity in rolling 1/7/30-day windows, calculated locally from `users.last_seen_at`. Include daily new-account counts. No account IDs leave the installation. Background authenticated traffic can count as activity; this is not a measure of time spent. |
| Users by version? | Latest snapshot per installation, grouped by current server release; sum registered and active-account totals. Label as accounts on installations currently running that version, not proof every action occurred on that version. |
| How large are installations? | Current workspace, project, and top-level task totals; histograms of members/projects/tasks per workspace and tasks per project. Keep shared workspace memberships separate from unique account totals. |
| How much work happens? | Daily new top-level tasks, run starts, terminal run outcomes, and coarse run-duration buckets, with fixed task-mode and execution-target categories. Count follow-ups, retries, reviewer runs, and swarm children separately rather than inflating top-level task creation. |
| Which features are used? | Daily usage counts and whether an installation used each fixed feature: Agent Swarm, reviewer workflows, scheduled tasks, task forks, browser/computer tools, connected-source operations, local execution, and canvas. Count actual operations rather than merely configured/enabled features. |
| Which models and types are used? | Counts of model requests by approved public model ID and resolved model type: the existing `openai`, `google`, and `claude` categories. Unknown/private model IDs collapse to `other_custom`; configured-but-unused models do not count. Agent/task modes remain a separate dimension. |
| How effective is prompt caching? | By approved model ID/type, sums of cached prompt tokens and total prompt tokens for responses that explicitly report cache usage; covered/missing response counts and the number with nonzero cached input. Missing cache fields are unknown, not zero. |
| Which errors occur? | Failed model attempts versus all model attempts, final failed runs versus terminal runs, and counts by approved error code/category and numeric HTTP status. Dashboard-friendly common error labels come from our fixed catalog, never arbitrary error text. |
| How many turns per run? | Histogram of completed logical model-loop turns per terminal run: `0`, `1`, `2-5`, `6-10`, `11-20`, `21-50`, `51-100`, `101+`. Separate user work, swarm/reviewer child work, and maintenance runs. |
| How often is context reduced? | Context-action attempts, successes, failures/skips and affected-run counts by fixed trigger/action categories; rates per eligible run or model turn, and idle actions per eligible idle opportunity. Count actual compactions, V2 rollovers, and truncation separately. |
| How full is the final context? | Sum, sample count, and histogram of final observed prompt saturation by model/type and context-management version. Use the final model input before any cleanup/reset, divided by that request's effective context limit; distinguish measured, estimated, and missing samples. |
| Which hosts execute work? | Coarse server-runtime OS/architecture and aggregate local-execution host counts using `linux`, `darwin`, `win32`, `other`, `unknown` and `x86_64`, `arm64`, `other`, `unknown`. Keep deployment runtime and local host categories separate. |
| Which clients are used? | Counts of successful task create/follow-up actions from `web_mobile`, `web_desktop`, `web_unknown`, `desktop`, or `unknown`. Desktop actions include coarse OS, official app release and shell (`electron`, `tauri`, `unknown`) when supplied by a trusted desktop bridge. Count actions, not unique sessions or people. |

Start count histograms with explicit buckets: `0`, `1`, `2-5`, `6-20`, `21-100`, `101-1000`, and `1001+`. Send bucket frequencies, never one record per workspace/project/task. Freeze each metric's counting unit in the schema: for example, a successful fork creation, a schedule firing, a run claimed for local execution, or one browser-using task per day. Reuse existing durable facts where available; add bounded local daily counters only for activity that cannot otherwise be counted cheaply.

Read small relational metadata and indexed activity records. Never walk filesystem trees, query conversation/tool-output bodies, restore archived tasks, or read files to construct telemetry. Large historical counts need maintained summaries or bounded incremental work; a daily timer does not justify an unbounded scan of task history.

Do not export per-feature account identities or add an account tracking system for funnels in the first version. Feature metrics initially answer adoption by installation and operation volume. Feature counters are best-effort product measurements, not an audit log.

### Measurement definitions and source boundaries

**Models and cache.** Resolve the actual routed model for each request, including fallback, rather than the user's original selection. Maintain an exact allowlist of public model IDs in the release; do not infer public status from a name prefix or treat an administrator's model catalog as approval to export it. Collapse unknown IDs before retaining telemetry. Never send provider endpoints, API keys, custom aliases or model-list contents. Model type means the product's resolved metadata type, not confirmed provider identity or a guessed model family. Keep router, embedding, and compaction requests in separate fixed purpose categories when already identifiable; do not instrument auxiliary calls merely to claim complete coverage. Show coverage.

For a model, token-weighted cache hit rate is `sum(cached_prompt_tokens) / sum(total_prompt_tokens)` over cache-reporting responses. Provider `input_tokens` already includes cached tokens in the existing usage records; API billing aggregates expose uncached input separately, so their equivalent denominator is `uncached + cached`. Do not add cached tokens twice or average request-level percentages. Track cache-write tokens separately only where already supplied. A zero token denominator is unavailable; missing fields/providers are excluded with coverage counts. Derive metrics from existing normalized usage without serializing a provider response.

**Errors.** Count provider/transport request attempts at the one authoritative gateway, including failed retries; successful recovery must not turn a finished run into a failed-run measurement. Use separate attempted/failed denominators for model requests and terminal runs. Cancellation, timeout, quota/rate limit, context overflow, invalid input, lease loss, network failure, and provider/internal failure have explicit fixed categories. Allowlisted public codes can retain their approved symbolic code; other codes become `unknown`. Map known messages locally to constants such as `context_length_exceeded`, `rate_limited`, or `provider_timeout`; discard the source message immediately. Do not upload scrubbed text, arbitrary code strings, error hashes, stack traces, response bodies, or fragments of shell/tool stderr. User-requested cancellation is its own outcome, not an application defect. Broader tool-error instrumentation is deferred unless a safe typed outcome already exists.

**Turns.** One turn is a logical model-loop step that returned an accepted response, not one tool call, SSE chunk, user message, or provider retry. A retry within a step increments attempt/error metrics, not turn count. Emit one run summary at the terminal boundary, including failed/cancelled/zero-turn runs with known counters. Resumed processing of the same logical run must carry forward its count rather than double-count replays; if that cannot be established cheaply, mark coverage incomplete. A new follow-up run is a new sample. Idle-compaction and other maintenance turns never inflate the user-work histogram.

**Compaction and truncation.** Use fixed triggers such as `automatic_threshold`, `provider_overflow`, `idle`, `manual`, and `swarm_fork`, and actions such as `summary_compaction`, `window_rollover`, `manual_clear`, `context_truncation`, and `model_output_limit`. The `compact_context` model-error recovery action is not an umbrella for idle compaction: idle work uses `compact_only` with `contextAction: idle`. V2 can reset a window without summarizing it; fork compaction prepares child seeds and does not compact the parent's context. Count those operations independently, at execution rather than enqueue. An attempt that succeeds is still one operation, not two compactions. Idle eligibility/skips are counted only at the existing scheduler decision, with no new polling sweep. If a denominator is unavailable, show counts/coverage rather than a fabricated rate.

Count actual context item/token drops and model responses stopped by output limits at their existing decisions; never search for the word `truncated` in content. Ordinary shell-output display clipping or an excerpt length limit is not context overflow, and is excluded initially. No new tokenization or text inspection for telemetry.

**Final saturation.** Preserve the final measured input-token count and effective model context limit before idle/manual cleanup clears state. Report `100 * final_input_tokens / context_limit` as the **last-request prompt saturation**, a proxy for context occupancy when the run ends, not an exact post-response token count. It excludes generated output and later unsent tool results. Optional existing local estimates can be reported separately, never mixed into the measured mean. Do not substitute zero after a reset or when usage is absent. Keep sum-of-percentages and sample count so global averages are run-weighted; include bounded percentage buckets and an explicit `100%+` overflow bucket. No extra provider request or tokenization pass to get a more exact percentage.

**Hosts and clients.** Read server OS/architecture from the process and local execution host categories from existing device metadata. Normalize Node `x64` to `x86_64`. A Linux container reports Linux even if its physical host is macOS/Windows; never probe Docker, hardware, hostnames, OS release, CPUs, RAM, or network interfaces to infer the underlying machine.

Classify desktop use through the explicit app bridge, not a user-agent substring; the current app is Electron. Reserve `tauri` for a future bridge that actually identifies itself. Phone/tablet/desktop web detection is coarse and fallible: normalize an already-present browser hint locally, allow `web_unknown`, and send no full user agent, screen resolution, font/GPU/browser fingerprint, or browser version. Attach approved enums to existing authenticated task actions only when telemetry is enabled. Do not classify every request, add client heartbeats, or persist client/session identifiers. The server drops hints when telemetry is disabled; older clients remain `unknown`. A desktop OS is a client OS, not evidence of where that task executed.

Keep these as separate small breakdowns, not a Cartesian product of model, error, feature, host, surface, and workspace. No per-run traces, run IDs, or user cohorts leave the installation. Cap retained category cardinality before buffering, collapse excess into fixed `other` categories, and expose dropped/unknown counts.

## Privacy boundary

Construct reports from an allowlist of typed scalars, bounded integers, fixed enums, and fixed buckets. Reject unknown keys and unapproved strings both before sending and at the collector. Do not expose a generic `track(name, properties)` API. Each new field requires a deliberate schema change.

Never include prompts, conversations, task/project/workspace names or IDs, files, paths, filenames, URLs, hostnames, email addresses, names, account IDs or hashes, connector account details, credentials, model prompts/responses, raw error messages, stack traces, custom model names, or custom agent names. Only exact approved public model IDs, fixed model types/error labels, and coarse platform/client categories are allowed.

The installation UUID makes these reports pseudonymous, not completely anonymous. Aggregate scale and feature usage are still information about an installation. The collector necessarily receives the server's network IP in transit. Disable IP/header/body access logging for ingestion at the application, proxy, and hosting layers; do not forward source addresses or request headers to PostHog. Allow only approved report fields in the forwarded body.

Set `$process_person_profile: false` and `$geoip_disable: true` on PostHog events; disable IP retention and GeoIP enrichment for the telemetry project as well. Restrict dashboard access. Proposed retention is 90 days for detailed installation reports; retain aggregates without installation identifiers longer. To deduplicate lifetime installation counts, keep a separate minimal registry containing only the random installation UUID and first/last reporting dates until an operator requests deletion. Disclose that longer identifier retention explicitly. Publish deletion/reset instructions and test the retention jobs.

## Delivery and operational cost

- Elect one reporter per database using a database-backed claim/lease, even with multiple API replicas. Spread daily reporting with jitter. Persist the last snapshot/report identity so restarts do not create new installations or duplicate periods.
- Freeze a small report in a bounded local outbox before sending. Retry that exact report and ID with a short request timeout and capped backoff. Keep at most seven daily reports; expire older ones. Do not replay activity from periods telemetry was disabled.
- Use short database statement timeouts and a strict payload cap, initially 32 KiB. Counter failures and collector outages must not fail user operations, delay readiness, or block task completion. Feature hooks perform no outbound network requests.
- Use in-memory integer/histogram updates at existing response/action boundaries, not synchronous database writes on each token, tool call, or request. Flush coalesced deltas at most once per minute per process with a non-overlapping timer and flush identity for retry deduplication; never create a raw observation queue. Local execution uses existing control traffic for bounded aggregates, with the API aggregating directly rather than waking an idle worker just for telemetry.
- Start with enforceable per-process caps: 256 KiB telemetry buffer, 256 aggregate rows per flush, 1-second database statement timeout, and a 5-second HTTP timeout. Allow at most three send attempts for each of at most seven retained daily reports. Cap cardinality in the schema so a 32 KiB report fits; overflow/skipped metrics are marked, never silently truncated or turned into zeros. Cap local aggregate storage with bounded expiry batches and no telemetry-only per-run history. Limit optional database concurrency and skip collection when the database is busy rather than competing with task work.
- Fixed-cap reducers drop excess observations rather than buffering or backpressuring user work. On repeated collection/flush failure, stop the optional work with capped backoff. Preserve completeness/coverage flags so missing data is visible. A process crash may lose at most its unflushed counters; do not add per-event durable writes to eliminate that loss. Graceful shutdown has a short bounded flush, never a readiness dependency.
- The collector accepts only the published schema, applies payload/rate limits, and forwards validated data over HTTPS. It is an ingestion endpoint, not an open proxy; destination configuration is operator-controlled. Forwarding failure leaves the report unacknowledged.
- Delivery can repeat after a timeout. Deduplicate by immutable report UUID in ingestion/queries; never rely on summing raw received events. Treat the public ingestion data as untrusted: a distributable token is not evidence of a real installation. These are adoption estimates, not verified licensing counts.

## Dashboard rules and limits

- Current install size, current user totals, and version adoption use only the latest snapshot per installation within the chosen activity window. A snapshot is a gauge, not an event count to sum across days. Show the freshness/window.
- Feature/task/run totals sum deduplicated non-overlapping daily increments. Account DAU/WAU/MAU use their respective locally computed windows; never add daily distinct counts to derive weekly/monthly distinct accounts.
- Present both installation-weighted distributions and overall totals so one large installation does not obscure typical adoption. Do not mix the latest snapshots from different dates into an exact global DAU claim.
- Disabled and offline installations are unobserved. An account on two servers counts twice; cross-install unique people and cross-install user journeys are deliberately unavailable. Database clones/resets can respectively undercount/overcount unique installations.
- Daily reporting is not real-time. Short-lived deployments and task records deleted before sampling can be missed; operational flows that need creation/activity totals require explicit counters. First-seen means first observed by telemetry, not actual installation date.
- Keep attempts, logical turns, terminal runs, and maintenance work in separate denominators. Unknown cache/context/client observations are visible coverage gaps, not zero usage. Show reporting freshness and partial-day/crash-loss markers. Avoid joining coarse platform/client fields into an installation fingerprint.

## Implementation plan

1. **Define the contract and module.** Add `packages/telemetry` with strict report/observation schemas, fixed catalogs, pure reducers and a no-op sink. Finalize disclosure, retention, build metadata and the counting units above before adding instrumentation.
2. **Add installation reporting.** Add a new numbered migration for telemetry identity/state and a bounded report outbox. Implement the API adapters, environment gate, snapshots, database leadership and native HTTP sender. Wire deploy variables and regenerate Coolify compose.
3. **Add runtime observations.** Add the narrow executor/worker hooks for model usage/cache, safe error outcomes, run turns, context actions and final saturation. Add feature counters and coarse host/client hints. Count local and hosted execution exactly once; keep maintenance work separate. Defer any metric requiring content scans, extra model requests, raw errors, fingerprints, or new client tracking.
4. **Connect ingestion and dashboards.** Deploy the small collector, minimal installation registry and dedicated PostHog project. Build dashboards covering the metric table. Validate weighted cache rates, run-weighted saturation, version snapshots and duplicate delivery against a deterministic fixture; show coverage and limits.
5. **Verify and document.** Complete the acceptance checks below, then the required test/lint/build checks. Publish self-hosting/privacy documentation and administrator disclosure before release. Leave CHANGELOG.md unchanged unless separately authorized.

## Acceptance checks

- Disabled mode schedules no telemetry timer, collects no telemetry counters, persists no reports/client hints, and sends no telemetry requests. API/worker gates agree; local executors cannot bypass them. Re-enable does not backfill the disabled period.
- Privacy fixtures containing secret-bearing errors, custom model IDs, URLs, paths, emails, raw user agents and unexpected keys cannot enter the buffer or outbound report. Known errors map to catalog labels; unknown values collapse safely. Strict validation also runs at ingestion.
- Cache fixtures distinguish raw inclusive input from normalized uncached input, missing versus zero cache, retries, and mixed request sizes. Verify token-weighted rates and coverage, not averages of percentages.
- Turn/context fixtures cover zero-turn failure, retry in a step, resume/replay, model changes, maintenance runs, V1 compaction, V2 rollover, idle success/failure/skip, fork child compaction, output limit and final usage cleared by a reset. Each denominator is explicit; missing final usage stays missing.
- Host/client fixtures distinguish container runtime, local executor and UI OS; unknown/tablet/spoofed hints remain coarse/untrusted. The browser has no persistent telemetry ID, dedicated tracking request, heartbeat, fingerprint API, or third-party SDK.
- Startup, replica races, upgrades, clone reset, deduplicated flush/report retries, expiry/deletion and collector failures preserve installation/report identity without impairing user work.
- With the network unavailable or buffers full, memory/rows/payload/retries stay within the stated bounds, domain operations never wait for delivery, and incomplete metrics are marked. Run a representative local load comparison: target under 1% added CPU over baseline, at most 1 MiB incremental telemetry memory per process, and no measurable p95 task-action latency regression. These are acceptance targets to measure, not performance claims. Reduce/defer metrics if they fail the budget; do not add infrastructure to rescue optional collection.

Success: an administrator sees the collection policy, can inspect exactly what is sent, and can disable it with one deploy variable without losing functionality. Telemetry has independently testable ownership, does not export application content/account identities, stays within measured resource budgets, and does not silently overcount installs, model calls, or version adoption.

## Reference documentation

Verified against official PostHog documentation on 2026-11-08:

- Capture and anonymous events: `https://posthog.com/docs/api/capture`
- IP retention, GeoIP, and collection controls: `https://posthog.com/docs/privacy/data-collection`

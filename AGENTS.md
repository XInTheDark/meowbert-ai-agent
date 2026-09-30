# Repository Guidelines

## Project Structure & Module Organization
- `apps/api`: Fastify API (auth, workspaces, environments, tasks, shell sessions, connectors).
- `apps/worker`: BullMQ worker that runs the OpenAI Responses loop and shell-first task execution.
- `apps/web`: React + Vite frontend (workspace, project, task, and shell UI).
- `packages/shared`: shared constants, schemas, and helpers used by API + worker + web.
- `db/migrations`: SQL migrations (apply with `npm run migrate`).
- `config`: JSON runtime configs (`global.example.json`, local `global.json`, and `global.docker.json`).
- `runtime/`: local runtime directories for environment/task filesystem state.

## Terminology
- User-facing product terminology is now **Project / Projects**. Prefer that wording in UI copy, docs, routes, and API surfaces.
- Legacy internal names like `environment`, `environments`, `envId`, DB table `environments`, or filesystem paths under `runtime/environments` may still exist where changing persistence or storage semantics would be risky.
- When adding new code, default to `project` naming unless you are intentionally touching one of those legacy persistence/path boundaries.

## Build, Test, and Development Commands
- `npm install`: install workspace dependencies.
- `npm run dev:api` / `npm run dev:worker` / `npm run dev:web`: run services locally.
- `npm run build`: compile all workspaces (`shared`, `api`, `worker`, `web`).
- `npm run test`: run Vitest across all workspaces.
- `npm run lint`: TypeScript no-emit checks across all workspaces.
- `npm run migrate`: apply DB migrations through API workspace CLI.
- `docker compose up -d`: start the core stack (`postgres`, `redis`, `api`, `worker`, `web`). `docker compose -f docker-compose.full.yml up -d` adds Listmonk email.
- `docker-compose.full.yml` `include`s `docker-compose.yml`. After changing either, run `npm run compose:coolify` to regenerate `docker-compose.coolify.yml` (a flat copy for Coolify); CI fails if it's stale.

## Coding Style & Naming Conventions
- Language: TypeScript (ESM) with strict typing.
- Style: 2-space indentation, semicolons, and double quotes.
- STRICT SRP RULE: every file must have exactly one reason to change. This is the highest-priority design rule and must not be violated.
- File size is only a smell, not the rule. A file may be long if and only if it still cleanly has one reason to change. If a file starts handling multiple domains, flows, or UI sections, split it immediately.
- Function/component length limits:
  - Target max: 60 lines per function.
  - Hard max: 120 lines per function.
  - If a function or React component exceeds the hard max, split it into smaller helpers/hooks/components before continuing.
- Do not hide SRP violations behind “utility” files, giant hooks, or giant config objects. The split must produce focused modules with clear ownership.
- Keep route handlers in `apps/api/src/routes`, domain logic in `apps/api/src/services`.
- React components use `PascalCase`; hooks/utilities use `camelCase`.
- Prefer descriptive names (`createShellSession`, `enqueueRun`) over abbreviations.
- When requesting structured model output, do not use JSON schema response format; use tool calling (function tools) with strict parameters instead. We have helpers for that already.
- For strict OpenAI function-tool schemas, every key in `parameters.properties` must appear in `parameters.required` (even nullable fields). Model optional semantics with `type: ["<kind>", "null"]`, not by omitting keys from `required`.
- Keep agent prompts short, natural, and direct. Do not turn them into AI-sounding checklists or rubrics: use only the detail needed to guide the behavior.

## Development Guidelines
### Testing

- Framework: Vitest (`*.test.ts` / `*.spec.ts`).
- Keep fast unit tests near changed code; add shared-schema tests in `packages/shared/src`.
- For API/worker/web changes, run at minimum: `npm run test`, `npm run lint`, `npm run build`.
- Add regression tests when fixing bugs (routing, task actions, shell session behavior).
- Test observable behavior and public contracts, not implementation details. Do not add tests that merely assert literal prompt prose or search a generated prompt for expected words; those tests are useless when they only mirror the implementation and do not prove behavior. Prompt tests are appropriate only when they exercise meaningful conditional assembly or a prompt-controlled contract that changes routing, permissions, tool availability, or another observable outcome. Otherwise test the resulting state, routing, permissions, tool availability, or user-visible outcome. This follows the behavior-over-implementation testing principle described in Google's testing guidance.
- Do not write tests for reversible, low-impact changes that mirror the implementation. If you do choose to verify your work with tests, make sure that the tests are meaningful and necessary to verify implementation.
- Run tests appropriate to the change and complete required checks. Once those pass, broaden or repeat testing only when new changes, failures, or unresolved concerns justify it; otherwise, continue toward completing the task.

### Database run-kind contract

- When adding, renaming, or routing a `TaskExecutionJob.mode`, update the shared/API/worker mode unions, every `task_runs_run_kind_check` definition, and the insert/enqueue regression coverage together.
- Never edit an already-applied migration to repair this contract. Add a new numbered migration that carries forward every existing allowed value plus the new one, then verify the migration is applied before retrying a failed workflow.
- A missing run-kind value can reject reviewer/run creation after workflow state has been persisted and strand the task without its completion path.

### Development notes

- After completing the task, you should ask if the user wants you to commit and push. 
- Do not modify CHANGELOG.md unless given permission to.
- If a runtime dependency is supposed to be guaranteed by the Docker image / environment image, bundle it there and use it directly. Do not add runtime fallback implementations or runtime self-installs for those dependencies.
- Hosted deploys must use the published sandbox runtime image instead of rebuilding `apps/sandbox-runtime/Dockerfile` on every deploy. The hosted/base compose uses `MEOWBERT_SANDBOX_RUNTIME_IMAGE` (default `ghcr.io/xinthedark/meowbert-ai-agent/sandbox-runtime:main`), and so does a plain `docker compose up`. To test sandbox changes locally, add `-f docker-compose.yml -f docker-compose.local-sandbox.yml`, which builds and uses `meowbert-sandbox-runtime:local`.
- Rebuild + republish the sandbox runtime image whenever changes touch sandbox-image inputs, especially: `apps/sandbox-runtime/**`, `skills/**`, `package.json`, `package-lock.json`, `apps/worker/scripts/resolve-browser-use-build.mjs`, `apps/worker/scripts/resolve-office-build.mjs`, or config changes that alter Browser Use / Office build toggles.
- Preferred publish path: GitHub Actions workflow `Publish Sandbox Runtime` (manual dispatch is fine, and it also auto-runs on `main` for relevant sandbox-image changes). If the user explicitly asks for a manual local publish instead, document the exact image tag used and remind them to update/pin `MEOWBERT_SANDBOX_RUNTIME_IMAGE` when appropriate.
- For UI work, do not default to verbose text-heavy buttons when the action is already obvious from context; prefer compact icon buttons or very short labels unless clarity truly requires text.
- For core task-entry surfaces, especially the New Task composer, do not add decorative description copy, status pills, capability pills, slogan text, or explanatory badges above the input. This is an antipattern in this app: keep the main action centered and focused on the composer unless a control is directly actionable.
- If you added a new feature, then ask the user if he wants you to update CHANGELOG, and update the docs website.
  - Guideline: Make sure to keep the same formatting & tone when updating changelog or docs! The docs have two audiences: people using Meowbert (Getting Started, Projects, Tasks, AI & Agents, Connectors), and people running their own server (Self-Hosting). Keep user pages free of server internals, and put setup and config details in the Self-Hosting section.


## Commit & Pull Request Guidelines
- Follow concise Conventional Commit style when possible: `feat:`, `fix:`, `chore:`.
- When creating a commit, always write a meaningful commit message. Do not use an empty/generic message; include at least a clear summary of what changed, and prefer a short body for non-trivial commits.
- Keep one logical change per commit; include migrations/config changes in the same PR when required.
- PRs should include: purpose, key changes, validation steps/commands, and screenshots for UI updates.
- Call out breaking changes and config updates explicitly (especially under `config/` and `db/migrations/`).

## Security & Configuration Tips
- Use JSON config files; do not commit real secrets in `config/global.json`.
- For Docker, rely on `MEOWBERT_CONFIG_PATH` (compose defaults to `config/global.docker.json`).
- Do not add personal infrastructure, domains, credentials, or deployment-specific setup. Defaults must work for a fresh self-hosted install.

### Recovery and persistence contracts

- A missing queue job is a recovery condition, not evidence that a task should be cancelled. Recovery must advance through bounded batches, including when earlier runs are healthy, and preserve explicit cancellation/interrupt flags.
- Commit successful run completion and pending result delivery in one transaction. Retry delivery independently of task execution, retaining acknowledgements for channels already delivered.
- When adding persistent task history, include its large payloads in cold archive/restore while preserving IDs and branch ancestry. Note snapshots belong to context nodes; retain the latest revision per path within each node rather than every intermediate append.

### Prompt caching contract

- Keep the agent prompt prefix stable across runs of a task: no timestamps, recent-turn lists or other per-message state in the system prompt or setup deltas. Add mid-run notes through `appendPromptEnvelopeDelta`, which queues them at the end of the conversation once the prefix is sealed. The full contract is documented at the top of `apps/worker/src/services/agent/prompt-envelope.ts`.

## Licensing
- Meowbert is licensed under AGPL-3.0. Only add third-party code or assets whose license permits redistribution under AGPL-3.0, and record them in `THIRD_PARTY_NOTICES.md`.

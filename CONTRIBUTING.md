# Contributing to Meowbert

Thanks for your interest in improving Meowbert. Bug reports, fixes, docs improvements, and new skills are all welcome.

## Before you start

- For anything bigger than a small fix, open an issue first so we can agree on the approach.
- Security problems go through [private reporting](SECURITY.md), not public issues.
- By contributing, you agree that your contributions are licensed under the [AGPL-3.0](LICENSE).

## Development setup

You need Node.js 22, npm, and Docker.

```bash
npm install
cp config/global.example.json config/global.json   # then set security.jwtSecret
docker compose up -d meowbert-postgres meowbert-redis meowbert-meilisearch
npm run migrate
```

Run each service in its own terminal:

```bash
npm run dev:api      # http://localhost:4000
npm run dev:worker
npm run dev:web      # http://localhost:5173
npm run dev:docs     # optional, docs site
```

Create the first account in the web app (it becomes the admin), then add a model provider in **Admin → AI providers**.

### Working on the sandbox image or skills

Tasks run inside the sandbox runtime image. If you change `apps/sandbox-runtime/**` or `skills/**`, build and use a local image:

```bash
docker compose -f docker-compose.yml -f docker-compose.local-sandbox.yml build sandbox-runtime
```

and set `runtime.sandbox.image` in your config to `meowbert-sandbox-runtime:local`.

## Project layout

| Path | What's there |
| --- | --- |
| `apps/api` | Fastify API: auth, workspaces, projects, tasks, connectors |
| `apps/worker` | Agent loop and task execution |
| `apps/web` | React web app |
| `apps/desktop` | Electron desktop app |
| `apps/docs` | Documentation site (VitePress) |
| `apps/sandbox-runtime` | Sandbox container image |
| `packages/shared` | Code shared by the API, worker, and web app |
| `skills/` | Built-in skills |
| `db/migrations` | SQL migrations |

## Code style and checks

[`AGENTS.md`](AGENTS.md) describes the conventions we follow: TypeScript (ESM, strict), one responsibility per file, short functions, and tests that check behavior rather than implementation details. It's written for AI coding agents, and it applies to human contributors too.

Before opening a pull request, run:

```bash
npm run lint
npm run test
npm run build
```

## Pull requests

- Keep each pull request to one logical change.
- Use [Conventional Commit](https://www.conventionalcommits.org) prefixes: `feat:`, `fix:`, `docs:`, `chore:`.
- Describe what changed and how you tested it. Include screenshots for UI changes.
- Call out any changes to config files or database migrations.

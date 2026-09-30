# Meowbert

**A self-hosted AI agent workspace for real work.** Give an agent a task and it works in its own sandbox on your server: it runs commands, writes code, browses, builds documents, and keeps going while you're away. Use any model that speaks the OpenAI Responses API.

[Quickstart](#quickstart) · [Documentation](apps/docs/docs/index.md) · [What you can count on](apps/docs/docs/introduction/principles.md) · [Known limitations](apps/docs/docs/introduction/limitations.md)

## Why Meowbert

- **Yours, end to end.** The web app, API, database, and every agent sandbox run on your own hardware. No telemetry, no hosted service in the middle.
- **Any model.** Connect OpenAI, a gateway, or a local model server. Offer several models, set reasoning effort per model, and combine them in an **Agent Swarm**.
- **A real computer for the agent.** Each task gets a fresh container with a shell, git, Python, Node, a browser, and Office and PDF tools. It's locked down by default, with optional [gVisor](https://gvisor.dev) isolation.
- **Work that lasts.** Projects keep their files, memory, and task history. Come back to any task weeks later and pick up where you left off, or branch it to try something else.
- **Runs while you're away.** Schedule tasks, let them loop for hours, and get results in Telegram, Discord, email, or a push notification. A **Project Master** keeps track of what's running and follows up.
- **Made for teams.** Multiple users and workspaces, shared projects, per-user limits, and an admin panel.

## Features

| | |
| --- | --- |
| **Tasks** | Conversations with an agent that can act. Follow up, branch, fork, pause, resume, share, and export. |
| **Workflows** | Standard tasks, Long Horizon planning with review, Deep Research, Quality control, and multi-model Agent Swarms. |
| **Scheduling** | Cron-scheduled, infinite, and timed tasks, with step and time budgets. |
| **Projects** | Persistent files, instructions, memory, a file browser, and live shells. |
| **Skills** | Word, PowerPoint, and PDF authoring, browser automation, image generation, interactive canvases, web research, and your own custom skills. |
| **Connectors** | Start and continue tasks from Telegram, Discord, GitHub, and email. |
| **Sources** | Give tasks access to Google Drive, OneDrive, pCloud, Outlook, rclone remotes, and YouTube. |
| **Memory** | Durable workspace and project notes that agents search and update. |
| **Apps** | Web app (installable as a PWA), and desktop apps for macOS and Windows with computer use. |

## Quickstart

You need a Linux server (x86-64) with Docker, and an API key for a model provider that supports the OpenAI Responses API. See the [system requirements](apps/docs/docs/introduction/requirements.md).

```bash
git clone https://github.com/XInTheDark/meowbert-ai-agent.git
cd meowbert-ai-agent
./scripts/setup.sh
docker compose up -d
```

Open `http://localhost:5173` and create your account. The first account becomes the admin, and a short wizard walks you through connecting a model provider and choosing models. The [Quickstart guide](apps/docs/docs/getting-started/quickstart.md) covers each step, and [Configuration](apps/docs/docs/self-hosting/configuration.md) explains how to reach Meowbert from other machines.

## How it works

```text
Web app / desktop app / Telegram, Discord, email
                    │
                    ▼
      API (Fastify) ── PostgreSQL, Redis, Meilisearch
                    │  queues task runs
                    ▼
      Worker ── model provider (OpenAI Responses API)
                    │  runs tools
                    ▼
      Sandbox container per task (Docker, optional gVisor)
```

The API handles accounts, workspaces, projects, and tasks. The worker runs the agent loop: it calls the model, executes tool calls inside the task's sandbox, and streams events back to the app. Everything is stored in PostgreSQL and on disk, so work survives restarts.

## Documentation

The full docs are in [`apps/docs`](apps/docs/docs/index.md), and Docker Compose also serves them at `http://localhost:4173`.

- **Using Meowbert:** [Overview](apps/docs/docs/getting-started/overview.md), [Task Composer](apps/docs/docs/core-workflows/task-composer.md), [Scheduled tasks](apps/docs/docs/core-workflows/scheduled-tasks.md), [Workflows & Agent Swarm](apps/docs/docs/core-workflows/task-workflows.md), [Connectors](apps/docs/docs/core-workflows/connectors.md)
- **Self-hosting:** [Configuration](apps/docs/docs/self-hosting/configuration.md), [Models & Providers](apps/docs/docs/self-hosting/models-and-providers.md), [Sandbox & Security](apps/docs/docs/self-hosting/sandbox-security.md), [Custom Skills](apps/docs/docs/self-hosting/custom-skills.md), [Backups & Upgrades](apps/docs/docs/self-hosting/backups-and-upgrades.md)

## About the project

Meowbert started in February 2026 as a personal project and was developed privately for about seven months before this first public release. The history before release isn't included in this repository.

It's early, and some parts are rougher than others. The [known limitations](apps/docs/docs/introduction/limitations.md) list what to expect. Issues and pull requests are welcome; see [CONTRIBUTING.md](CONTRIBUTING.md), and report security issues [privately](SECURITY.md).

## License

Meowbert is licensed under the [GNU Affero General Public License v3.0](LICENSE). Bundled third-party components keep their own licenses; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

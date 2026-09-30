---
title: Quickstart
summary: Install Meowbert with Docker Compose and run your first task in about ten minutes.
---

# Quickstart

This guide takes you from nothing to a running Meowbert server on a Linux machine with Docker. Check the [system requirements](/introduction/requirements) first.

## 1. Get the code

```bash
git clone https://github.com/XInTheDark/meowbert-ai-agent.git
cd meowbert-ai-agent
```

## 2. Run the setup script

```bash
./scripts/setup.sh
```

It creates `config/global.docker.json` with a fresh secret, and the folders where Meowbert keeps its data (`/srv/meowbert/runtime` and `/data/meowbert`). It may ask for your password to create them. It never overwrites anything that's already there.

## 3. Start Meowbert

```bash
docker compose up -d
```

The first start takes a while: Docker downloads the sandbox image (several GB) and builds the app. Check progress with `docker compose ps`. When the `api` service shows `healthy`, you're ready.

## 4. Create your admin account

Open `http://localhost:5173` in your browser. On a new server the sign-in page opens on **Create your account**. The first account becomes the server's admin.

## 5. Connect a model provider

Right after you sign in, a short setup wizard asks for:

1. **A model provider**: a base URL and API key for any service that supports the OpenAI Responses API (for OpenAI: `https://api.openai.com/v1`).
2. **Your models**: the models people can pick for tasks, and how hard each one should reason. The first one is the default.
3. **Background models**: a fast, inexpensive model for routing and quick jobs.
4. **Sign-ups**: whether other people can create accounts.

You can change all of this later in the **Admin Panel**. See [Models & Providers](/self-hosting/models-and-providers) for details.

## 6. Run your first task

Open your project, click **New Task**, and describe what you want done, for example:

> Find the five most-starred Rust web frameworks on GitHub and write a comparison table to `frameworks.md`.

Watch the agent work in the task view, then ask a follow-up in the same conversation. A short tour walks you through the rest of the app.

## Next steps

- [Configuration](/self-hosting/configuration): ports, passwords, storage, and other settings
- [Sandbox & Security](/self-hosting/sandbox-security): isolation, gVisor, and network access
- [Connectors](/core-workflows/connectors): talk to Meowbert from Telegram, Discord, or email
- [Workspace Navigation](/getting-started/workspace-navigation): find your way around

::: tip Reaching Meowbert from other machines
Out of the box the web app talks to the API at `http://localhost:4000`. To use Meowbert from another device, put it behind a reverse proxy with HTTPS and set `VITE_API_URL` (web) and `server.publicUrl` (config) to the public addresses. See [Configuration](/self-hosting/configuration#reaching-meowbert-from-other-machines).
:::

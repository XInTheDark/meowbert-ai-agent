---
title: Sandbox & Security
summary: How Meowbert isolates agents, how to make isolation stronger with gVisor, and what to keep in mind when self-hosting.
---

# Sandbox & Security

Agents in Meowbert run real commands. This page explains what keeps them contained and what you're responsible for as the server's operator.

## How tasks are isolated

Each task run and shell session gets its own short-lived Docker container, created from the sandbox runtime image. By default every sandbox:

- Sees only the project and task folders it was given, not the rest of the server
- Has a **read-only** system filesystem, with a private writable `/tmp`
- Runs as a **non-root user** with **all Linux capabilities dropped** and `no-new-privileges`
- Is limited in **memory, CPU, and number of processes** (`runtime.sandbox.resources`)
- Is removed when the work is done

### Network access

Sandboxes can reach the internet by default, because most useful work (installing packages, calling APIs, browsing) needs it. Turn off **Allow Sandbox Network Access** in workspace or project settings to run tasks with no network. Tasks that use connected sources still get network access, since they need it to reach those services.

### Running as root

A server admin can turn on **Run as root** for a workspace, for tasks that need to install system packages. It makes escaping the container easier, so only use it for trusted workspaces.

## Stronger isolation with gVisor

The default sandbox relies on standard Docker isolation, which shares the host's Linux kernel. A kernel vulnerability could let a determined attacker break out.

[gVisor](https://gvisor.dev) adds another layer: its `runsc` runtime puts a user-space kernel between the sandbox and your real kernel, so most system calls never reach the host directly. It's the same technology many cloud platforms use to run untrusted code. The trade-offs are some performance overhead, mainly for heavy file and network I/O, and occasional incompatibility with unusual system calls.

Meowbert doesn't use gVisor out of the box, because it needs to be installed on the host. To enable it:

1. Install gVisor on the Docker host by following the [official instructions](https://gvisor.dev/docs/user_guide/install/), then register it with Docker:
   ```bash
   sudo runsc install
   sudo systemctl restart docker
   ```
2. Check that it works:
   ```bash
   docker run --rm --runtime=runsc hello-world
   ```
3. In `config/global.docker.json`, set the sandbox runtime:
   ```json
   "runtime": {
     "sandbox": {
       "runtime": "runsc"
     }
   }
   ```
4. Restart: `docker compose restart api worker`.

New sandboxes now start under gVisor. It only affects task sandboxes; Meowbert's own services keep running normally.

::: info No sandbox is perfect
gVisor makes escapes much harder, but it's not a guarantee. Treat agents like a capable but untrusted user of the machine.
:::

## What the operator should know

- **The API and worker can control Docker.** They mount the Docker socket so they can start sandboxes, which gives them root-equivalent access to the host. Keep them patched, and don't expose Docker or the internal services to the network.
- **Keep internal ports private.** Postgres, Redis, and Meilisearch bind to `127.0.0.1` by default. If you change that, set strong passwords in `.env` first.
- **Use HTTPS** when Meowbert is reachable from other machines. Put it behind a reverse proxy such as Caddy, nginx, or Traefik.
- **Control who can sign up.** New servers only allow the first account (the admin). See [Users & Sign-ups](/self-hosting/users-and-signups).
- **Be careful with credentials you give agents.** Anything a task can read, including connected sources, GitHub tokens, and project files, the agent can use.

Found a security issue? Please [report it privately](https://github.com/XInTheDark/meowbert-ai-agent/security/advisories/new).

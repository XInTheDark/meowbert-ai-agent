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

## Allowing user namespaces without gVisor

Some tools create their own Linux namespaces from inside the sandbox, for example `unshare -rn` to run a command with no network access. Under gVisor this works out of the box. Under Docker's default runtime (`runc`), Docker's seccomp and AppArmor profiles block it, and the command fails with "Operation not permitted".

On Ubuntu 23.10 and later, the host also blocks unprivileged user namespaces by default. If commands still fail after turning on the setting below, check `sysctl kernel.apparmor_restrict_unprivileged_userns` on the host: `1` means the host is blocking them, and `sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=0` lifts it for every process on the host. Add the same line to a file in `/etc/sysctl.d/` to keep it after reboots.

To allow it on `runc`, set `allowUserNamespaces` in `config/global.docker.json`:

```json
"runtime": {
  "sandbox": {
    "allowUserNamespaces": true
  }
}
```

Then restart: `docker compose restart api worker`.

This turns off seccomp and AppArmor confinement for task sandboxes, and stops Docker from masking parts of `/proc`, so commands that mount their own `/proc` (such as `unshare --mount-proc`) also work. Sandboxes still run as a non-root user with all capabilities dropped, `no-new-privileges`, a read-only system filesystem, and resource limits. The cost is a larger attack surface on the host kernel: kernel vulnerabilities reachable through user namespaces become reachable from tasks. Only turn it on when you trust the people running tasks, or use gVisor instead. It has no effect under gVisor, which already allows namespaces inside its own kernel.

## Capping memory for all sandboxes together

Each sandbox has its own memory limit (`runtime.sandbox.resources.memoryMb`), and `runtime.sandbox.maxRunningContainers` limits how many run at once. Together they keep total sandbox memory near `memoryMb × maxRunningContainers`, but Docker does not enforce that total. gVisor also uses some memory of its own outside each sandbox's limit.

To guarantee that sandboxes can never take memory the server needs for Postgres, Meowbert's services, and SSH, put every sandbox in one systemd slice with its own memory cap. Linux then stops sandboxes at the slice's limit, no matter how many are running:

```
host memory
├── system, Docker, Postgres, Redis, Meowbert services
└── meowbert-sandboxes.slice   (capped, for example at 13 GiB)
    ├── sandbox (memoryMb each)
    ├── sandbox
    └── ...
```

This needs a Linux host where Docker uses the systemd cgroup driver, which is the default on current Ubuntu and Debian.

1. Check the cgroup driver. It should print `systemd`:
   ```bash
   docker info --format '{{.CgroupDriver}}'
   ```
2. Create `/etc/systemd/system/meowbert-sandboxes.slice`. Size it so the rest of the server keeps enough memory: the example below suits a 24 GiB host running the full stack.
   ```ini
   [Unit]
   Description=Memory cap for Meowbert sandboxes

   [Slice]
   MemoryAccounting=true
   MemoryHigh=11G
   MemoryMax=13G
   MemorySwapMax=0
   TasksMax=8000
   ```
   `MemoryHigh` is where Linux starts reclaiming memory and slowing sandboxes down. `MemoryMax` is the hard cap: above it, a process inside a sandbox is killed rather than anything outside the slice. `MemorySwapMax=0` keeps sandboxes out of swap.
3. Load it:
   ```bash
   sudo systemctl daemon-reload
   sudo systemctl start meowbert-sandboxes.slice
   ```
4. Set `MEOWBERT_SANDBOX_CGROUP_PARENT=meowbert-sandboxes.slice` in `.env` (or your Coolify environment variables), or set `runtime.sandbox.cgroupParent` in `config/global.docker.json`. Then restart the API and worker.
5. Start a task, then check that its sandbox is listed under the slice:
   ```bash
   systemd-cgls --no-pager /meowbert-sandboxes.slice
   ```

Sandboxes started before the restart stay outside the slice until they end. Each sandbox also has swap turned off, so one that reaches its own `memoryMb` is stopped instead of pushing the server into swap.

## What the operator should know

- **The API and worker can control Docker.** They mount the Docker socket so they can start sandboxes, which gives them root-equivalent access to the host. Keep them patched, and don't expose Docker or the internal services to the network.
- **Keep internal ports private.** Postgres, Redis, and Meilisearch bind to `127.0.0.1` by default. If you change that, set strong passwords in `.env` first.
- **Use HTTPS** when Meowbert is reachable from other machines. Put it behind a reverse proxy such as Caddy, nginx, or Traefik.
- **Control who can sign up.** New servers only allow the first account (the admin). See [Users & Sign-ups](/self-hosting/users-and-signups).
- **Be careful with credentials you give agents.** Anything a task can read, including connected sources, GitHub tokens, and project files, the agent can use.

Found a security issue? Please [report it privately](https://github.com/XInTheDark/meowbert-ai-agent/security/advisories/new).

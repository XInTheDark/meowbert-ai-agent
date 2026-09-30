# Security Policy

Meowbert runs AI agents that execute commands on your infrastructure, so we take security reports seriously.

## Reporting a vulnerability

Please **don't** open a public issue. Report it privately through [GitHub security advisories](https://github.com/XInTheDark/meowbert-ai-agent/security/advisories/new).

Include what you found, how to reproduce it, and what an attacker could do with it. You'll get a reply as soon as possible, and we'll keep you updated while we work on a fix.

## What's in scope

- Escaping the task sandbox, or reaching files, containers, or networks a task shouldn't have access to
- Reading or changing another user's or workspace's data
- Authentication and authorization bypasses
- Leaking secrets such as provider API keys or connector tokens

## Things to know when self-hosting

- The API and worker containers have access to the Docker socket so they can start task sandboxes. Anyone who controls those containers effectively controls the host. Keep the API behind authentication and don't expose Postgres, Redis, or Meilisearch to the internet.
- Sandboxes use standard Docker isolation by default. For stronger isolation, run them with [gVisor](https://gvisor.dev) (see the sandbox security docs).
- Agents can run any command inside their sandbox and reach the network. Only give them credentials you're comfortable with them using.

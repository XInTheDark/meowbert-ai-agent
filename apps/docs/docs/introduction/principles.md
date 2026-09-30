---
title: What You Can Count On
summary: The promises Meowbert makes about where it runs, which models it uses, and what happens to your work.
---

# What You Can Count On

Meowbert is built for people who want a capable AI agent without handing their work to someone else's cloud. These are the things it's designed to guarantee.

## It runs on your hardware

Meowbert is fully self-hosted. The web app, API, worker, database, search index, and every agent sandbox run on a machine you control, whether that's a home server, a VPS, or a laptop. There's no Meowbert cloud service behind it, and nothing is sent to the Meowbert project. The code contains no telemetry or analytics.

The only outside service it needs is the model provider you choose, and that can also be a model server you run yourself.

## You choose the model

Meowbert talks to models through the **OpenAI Responses API**. Any provider or gateway that implements it works: OpenAI itself, API gateways and proxies, or a local model server with Responses support. You can offer several models side by side, set different reasoning effort for each, and mix them in one [Agent Swarm](/core-workflows/task-workflows).

Users can also bring their own key or sign in with a ChatGPT subscription, if you allow it. See [Bring Your Own Provider](/core-workflows/byo-providers).

## Agents work in a sandbox

Every task runs in its own short-lived Docker container. The agent gets a real shell and can install packages, run code, and use git, but only inside that container and the project files it was given. The container has a read-only system filesystem, runs without Linux capabilities, and has CPU, memory, and process limits. For stronger isolation you can run sandboxes under gVisor. See [Sandbox & Security](/self-hosting/sandbox-security).

## Your work stays yours, and it lasts

Conversations, files, and task history are stored in your own PostgreSQL database and on your own disk. Nothing expires. You can:

- Come back to any task days or weeks later and continue the conversation where it left off
- Branch a conversation to try another approach without losing the original
- Stop a long-running task and resume it later
- Restart the server: queued and running work is recovered

## It's open source

Meowbert is licensed under the [AGPL-3.0](https://github.com/XInTheDark/meowbert-ai-agent/blob/main/LICENSE). You can read every line, change it, and run it however you like. If you offer a modified version to other people over a network, the license asks you to share your changes too.

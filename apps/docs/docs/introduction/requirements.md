---
title: System Requirements
summary: What you need to run Meowbert.
---

# System Requirements

## Server

| | Minimum | Recommended |
| --- | --- | --- |
| **OS** | Linux, x86-64 | Ubuntu or Debian, x86-64 |
| **CPU** | 2 cores | 4+ cores |
| **Memory** | 4 GB | 8 GB or more |
| **Disk** | 30 GB free | 60 GB+ on an SSD |
| **Software** | Docker Engine with Docker Compose v2 | Same, plus [gVisor](/self-hosting/sandbox-security) for stronger isolation |

A few notes:

- **Memory** scales with how many tasks run at once. Each task sandbox is limited to 2 GB by default (`runtime.sandbox.resources.memoryMb`), and a worker runs up to 4 tasks at a time (`runtime.workerConcurrency`).
- **Disk** is mostly the sandbox image (several GB, because it includes browsers, LibreOffice, and document tools) plus your project files and database.
- **ARM (arm64)**: the published sandbox image is x86-64 only for now. On ARM servers, build the image yourself with `docker-compose.local-sandbox.yml`.
- **macOS and Windows**: Docker Desktop can run Meowbert for trying it out, but the default Compose file uses Linux host paths such as `/srv/meowbert` and `/data/meowbert`, and features like FUSE-based live folder sync need a Linux host. Production use on these platforms isn't tested.

## Model provider

You need access to at least one model through an API that supports the **OpenAI Responses API** (`POST /v1/responses`), with an API key if it requires one. See [Models & Providers](/self-hosting/models-and-providers).

## Clients

- Any current desktop or mobile browser
- Optional: the [desktop app](/getting-started/desktop-app) for macOS and Windows

---
title: Custom Skills
summary: Add your own skill to Meowbert by building a custom sandbox image.
---

# Custom Skills

A **skill** gives agents extra instructions and, optionally, extra tools. Meowbert's built-in skills live in the `skills/` folder of the repository. See the [Skills Reference](/reference/skills) for what's included.

You can add your own today, but it takes a few steps, because skills are baked into the sandbox runtime image. Easier installation is planned.

## 1. Fork the repository

Fork [meowbert-ai-agent](https://github.com/XInTheDark/meowbert-ai-agent) and clone your fork.

## 2. Create the skill folder

Add a folder under `skills/` with three files:

```text
skills/my-skill/
├── skill.json   # manifest
├── skill.md     # instructions shown to the agent when the skill is enabled
└── server.mjs   # the skill's MCP server
```

Every skill runs an [MCP](https://modelcontextprotocol.io) server inside the sandbox. For a skill that only adds instructions, use the shared instructions-only server, the same way `skills/guided-learning` does:

```js
// skills/my-skill/server.mjs
import { startInstructionSkillServer } from "../shared/instruction-skill-server.mjs";

startInstructionSkillServer({ name: "my-skill", version: "1.0.0" }).catch((error) => {
  console.error(error);
  process.exit(1);
});
```

```json
// skills/my-skill/skill.json
{
  "id": "my-skill",
  "name": "My skill",
  "description": "One sentence on when to use it. Agents and users see this.",
  "mcp": {
    "transport": "stdio",
    "command": "node",
    "args": ["server.mjs"],
    "cwd": "{{SKILL_DIR}}"
  }
}
```

To give the skill its own tools, write a full MCP server instead. `skills/image-generation` is a good example. Set `"requiresSuperAdmin": true` to limit the skill to admins.

## 3. Build the sandbox image

```bash
docker compose -f docker-compose.yml -f docker-compose.local-sandbox.yml build sandbox-runtime
```

This builds `meowbert-sandbox-runtime:local` with your skill included.

## 4. Use your image

Start Meowbert with the same two Compose files so the API and worker use your local image:

```bash
docker compose -f docker-compose.yml -f docker-compose.local-sandbox.yml up -d
```

Or push the image to a registry and set `MEOWBERT_SANDBOX_RUNTIME_IMAGE` in `.env`. Forks on GitHub can use the included **Publish Sandbox Runtime** workflow to publish their own image to GitHub Container Registry.

Your skill now appears in the task composer's skill list.

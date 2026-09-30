# Environment personality prompts

Each file here contains instruction text injected into the task-agent system prompt when
`json_payload.default_context.personality` is set for an environment.

Supported personality IDs:
- `none` -> `none.md` (empty file means inject nothing)
- `default` -> `default.md`
- `concise` -> `concise.md`
- `neural` -> `neural.md`
- `friendly` -> `friendly.md`
- `cold` -> `cold.md`
- `aggressive` -> `aggressive.md`

These files are loaded by the API and worker at startup and cached in memory.
After changing any file, restart both processes to apply updates everywhere.

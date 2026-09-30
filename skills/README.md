# Skills

Each subdirectory contains a skill definition:

- `skill.json` — manifest (id, name, description, MCP server config)
- `skill.md` — documentation shown to the agent when the skill is enabled

`skill.json` supports optional access metadata:

- `requiresSuperAdmin` (boolean, optional) — when `true`, only platform super admins can see and use the skill.

See `config/global.example.json` for the `skills.rootDir` configuration.
Browser Use also supports the server-level `skills.browserUse.enabled` toggle; when disabled, the skill is hidden and the sandbox runtime image skips bundling Chromium.
Canvas also supports the server-level `skills.htmlCanvas.enabled` toggle; when disabled, the skill is hidden. When Browser Use or Canvas is enabled, the sandbox runtime image bundles Chromium for Playwright-based rendering.
DOCX Studio and PPTX Studio also support the server-level `skills.office.enabled` toggle; when disabled, those deterministic Office skills are hidden and the sandbox runtime image skips bundling LibreOffice.
Image Generation uses `skills/image-generation/image-generation.config.json` for OpenAI-compatible provider settings such as `baseURL`, `apiKey`, `apiKeyEnvVar`, headers, and retry limits. It supports both image generation and task-file-backed image edits.

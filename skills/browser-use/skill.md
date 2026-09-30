# Browser Use

Use this skill to automate websites with Playwright MCP.

## Runtime profile

- This skill is pinned to Playwright-managed `chromium` in headless isolated mode (not system Chrome).
- The MCP server is bundled into the sandbox runtime image and launched from the local pinned package, not `npx`.
- A local wrapper resolves the exact bundled Chromium executable path before launching Playwright MCP, which avoids registry/path drift inside the sandbox image.
- The skill still uses `--no-sandbox` to keep Chromium startup reliable inside Docker sandbox containers.
- The full Playwright `chromium` browser bundle is installed once into the sandbox runtime image at `/ms-playwright`.

## Installation

1. Set `skills.browserUse.enabled` in `config/global.json` (or `config/global.docker.json`) to `true`.
2. Rebuild the sandbox image after changing the toggle or pulling Browser Use updates:
   - `docker compose build sandbox-runtime`
3. Start a fresh task run or terminal session so the new sandbox image is used.
4. Set `skills.browserUse.enabled` to `false` and rebuild the sandbox runtime image to remove bundled browser assets.

## Workflow

1. Start with `browser_navigate`.
2. Inspect page state with `browser_snapshot` before choosing refs.
3. Interact using `browser_click`, `browser_type`, `browser_fill_form`, or `browser_select_option`.
4. Extract data with `browser_snapshot` or `browser_evaluate`.
5. Capture evidence with `browser_take_screenshot` when needed.

## Notes

- Prefer ref-based actions from the latest snapshot for reliability.
- Use `browser_tabs` to manage multiple pages.
- If Browser Use is enabled in config but the sandbox runtime image was built without it, Browser Use startup will fail until you rebuild `meowbert-sandbox-runtime:local`.
- If Chromium fails to start with missing shared-library errors, rebuild the sandbox image so it picks up the updated Playwright runtime packages.

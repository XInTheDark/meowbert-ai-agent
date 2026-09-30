# deep-ai-search-mcp

AI-powered **Search** + **Fetch** MCP server.

This is a “Perplexity-style” web search workflow built on top of:

- Brave Search API (for fast web search results)
- Vercel AI SDK (big + small LLMs for query-variant generation, relevance filtering, and smart chunk selection)
- Readability + Turndown (HTML -> clean Markdown)
- (Optional) puppeteer-extra + stealth plugin (auto fallback when blocked)
- (Optional) python `markitdown` (file -> Markdown conversion)

## Tools

### `search`

Breadth-optimized web search:

1. Map `breadth` (0-10) to internal params (query variants, candidate pool size, domain diversity) using math-based scaling (no lookup tables).
2. Use the **big LLM** to generate query variants.
3. Call Brave Search in parallel (bounded concurrency).
4. Interleave results (1st from each variant, then 2nd, …) and dedupe by normalized URL.
5. Use the **small LLM** to filter obviously-irrelevant results (batched; returns indexes only).
6. Select a domain-diverse set of final results.

Inputs:

- `query` (string)
- `breadth` (number 0-10, default 4)
- `domain_allowlist` / `domain_blocklist` (optional string[])
- `brave_params` (optional object) – pass-through Brave query params like `freshness`, `country` (ISO alpha-2, e.g. `US`), `search_lang`, `ui_lang`, `safesearch`

### `fetch`

Depth-optimized URL fetching:

- HTML: fetch -> Readability -> Turndown -> Markdown
- Files: download -> python `markitdown` -> Markdown
- Images: download -> return MCP image content
- If blocked: retry with puppeteer + stealth (if installed)

Modes:

- `smart_mode` (default `true`): if content is longer than `depth` budget, chunk + use **small LLM** to pick best chunks.
- `ai_mode` (default `false`): after extraction (and smart selection), run **big LLM** with `prompt` and return the generated answer.
- If `aiFeaturesEnabled` is `false`, these AI modes are disabled and omitted from the MCP tool schema; `fetch` returns extracted/truncated content only.

Inputs:

- `url` (string)
- `depth` (number 0-10, default 4)
- `smart_mode` (boolean, default true)
- `ai_mode` (boolean, default false)
- `prompt` (optional string): selection hint for smart_mode and/or instruction for ai_mode

## Configuration

This server supports a **JSON config file** (recommended for non-trivial setups) plus environment-variable overrides.

### Config file

- Default filename (auto-detected in the repo working directory): `deep-ai-search.config.json`
- Or specify a path explicitly with: `DEEP_AI_SEARCH_CONFIG_PATH=/path/to/config.json`

Note: some MCP hosts start servers with a different working directory than your terminal. The server will also try to find `deep-ai-search.config.json` relative to the server’s installed location (e.g. one directory above `dist/`), but the most reliable option in hosted clients is still setting `DEEP_AI_SEARCH_CONFIG_PATH` to an absolute path.

To get started:

```bash
cp deep-ai-search.config.example.json deep-ai-search.config.json
```

The config loader also supports `${ENV_VAR}` placeholders inside the JSON. If a placeholder is used and the env var is missing, the server will fail fast at startup.

Set `"aiFeaturesEnabled": false` to disable all LLM-backed behavior. In that mode:

- `search` runs a single vanilla Brave Search query with deterministic domain/diversity selection.
- `fetch` extracts and truncates raw content without smart chunk selection or AI summarization.
- `smart_mode`, `ai_mode`, and `prompt` are removed from the exposed `fetch` tool schema.
- LLM API keys are not required at startup.

### Request/response log file (JSONL)

If you want a simple "I/O transcript" for debugging, set:

- `logFile` in the JSON config (recommended: **absolute path**), or
- `DEEP_AI_SEARCH_LOG_FILE` as an environment variable

When enabled, the server appends **JSON Lines** (one JSON object per line) that include:

- MCP tool requests + responses (`search`, `fetch`)
- Brave Search HTTP requests + responses
- AI SDK structured generation requests + responses (the `system` + `prompt`, plus the generated object or error)

Note: this log intentionally avoids writing secrets like API keys, but it may include large page content in AI prompts/responses.

### Scaling (breadth/depth)

This project intentionally avoids per-level lookup tables like “breadthMap/depthMap”.
Instead, it uses **geometric (log-style) interpolation** between min/max values.

Tune these in the config file:

- `search.scaling.exponent` (default `0.6`)
  - Controls how aggressively breadth ramps up work.
  - Lower = ramps up earlier (more aggressive at low breadth).
  - Higher = ramps up later (more conservative at low breadth).
- `search.returnCountMax` (default `50`) + `search.scaling.returnCountExponent` (default `0.5`)
  - Controls how many final results can be returned at high breadth.
  - `returnCountExponent` lets us ramp the return count differently from other breadth-scaled knobs.
- `search.scaling.resultsPerQueryMin` (default `10`)
  - Minimum `count` we request from Brave per query variant (at breadth=0).
- `search.scaling.maxPerDomainAtMinBreadth` / `maxPerDomainAtMaxBreadth`
  - Soft domain diversity control (non-decreasing with breadth).
  - Higher values allow more results from the same domain.
- `fetch.depthScaling.minChars/maxChars/exponent`
  - Controls the max returned text length as depth increases.
- `fetch.maxImageUrlsInMarkdown` (default `10`)
  - Limits how many image URLs are preserved in HTML -> Markdown conversion.
  - After the first N images, subsequent images are rendered as `[Image]` (no URL).

### Brave rate limits (429)

Brave can rate-limit requests (HTTP 429), especially at higher breadth (more parallel queries).

This server handles 429s by:

- Rotating across `brave.apiKeys`
- Putting rate-limited keys on a cooldown
- Retrying up to `brave.retry.maxRetries` (bounded backoff; respects `Retry-After` when enabled)

Tune in config:

- `brave.retry.maxRetries`
- `brave.retry.initialBackoffMs`
- `brave.retry.maxBackoffMs`
- `brave.retry.respectRetryAfter`

### Custom / OpenAI-compatible providers

If you have an OpenAI-compatible gateway (your own provider, a proxy, OpenRouter-like service, etc), set:

- `llm.big.provider = "openai"`
- `llm.big.baseURL = "https://your-gateway.example.com/v1"`
- optional: `llm.big.headers` and `llm.big.name`
- optional: `llm.big.forceToolCall = true` if your gateway does not support OpenAI's `response_format: { type: "json_schema", ... }` structured outputs
  - When enabled, structured output calls will be implemented via *forced tool calling* instead.

Same for `llm.small.*`.

### Environment variables

Environment variables override the config file (useful for secrets in Claude Desktop).

Required:

- `BRAVE_API_KEY` (or `BRAVE_API_KEYS` as a comma-separated list)
- Big LLM (only when `aiFeaturesEnabled` is true):
  - `DEEP_AI_SEARCH_BIG_PROVIDER` = `openai` | `anthropic` (default: `openai`)
  - `DEEP_AI_SEARCH_BIG_MODEL` = model id (e.g. `gpt-4o`, `claude-3-5-sonnet-latest`, etc.)
  - Provider API key:
    - OpenAI: `OPENAI_API_KEY`
    - Anthropic: `ANTHROPIC_API_KEY`
- Small LLM (only when `aiFeaturesEnabled` is true):
  - `DEEP_AI_SEARCH_SMALL_PROVIDER` (default: `openai`)
  - `DEEP_AI_SEARCH_SMALL_MODEL`
  - Provider API key env var as above (or set `DEEP_AI_SEARCH_SMALL_API_KEY_ENV`)
- `DEEP_AI_SEARCH_AI_FEATURES_ENABLED=false` disables all LLM-backed features from the environment.

Optional:

- `DEEP_AI_SEARCH_LOG_LEVEL` = `debug` | `info` | `warn` | `error`
- `DEEP_AI_SEARCH_LOG_FILE` = path to a JSONL file for request/response logging (see above)
- `BRAVE_MAX_CONCURRENCY` (default 6)
- `BRAVE_TIMEOUT_MS` (default 15000)
- `DEEP_AI_SEARCH_CONFIG_PATH` = path to a JSON file matching the internal config schema
- `DEEP_AI_SEARCH_CONFIG_JSON` = JSON string (same schema)

File conversion (optional):

- Install python `markitdown` with its document extras:
  - `python3 -m pip install 'markitdown[all]'`

Browser fallback (optional):

- This repo includes puppeteer packages under `optionalDependencies`. If those fail to install, `fetch` will still work but cannot do stealth browser fallback.

## Run Locally

From the repo:

```bash
npm install
npm run build

# Set env vars then run:
node dist/index.js
```

Dev mode:

```bash
npm run dev
```

Direct CLI mode (reuses the same `search` and `fetch` tool handlers):

```bash
npm run build

./scripts/deep-ai-search-cli search --input '{"query":"latest bun release notes","breadth":6}'
./scripts/deep-ai-search-cli fetch --input '{"url":"https://example.com","depth":5}'
```

You can also pass input via stdin:

```bash
echo '{"query":"vector databases benchmark 2026","breadth":4}' | ./scripts/deep-ai-search-cli search
```

## Claude Desktop Example

Add something like this to your Claude Desktop config:

```json
{
  "mcpServers": {
    "deep-ai-search": {
      "command": "node",
      "args": ["/absolute/path/to/deep-ai-search-mcp/dist/index.js"],
      "env": {
        "BRAVE_API_KEY": "…",
        "DEEP_AI_SEARCH_BIG_PROVIDER": "openai",
        "DEEP_AI_SEARCH_BIG_MODEL": "gpt-4o",
        "DEEP_AI_SEARCH_SMALL_PROVIDER": "openai",
        "DEEP_AI_SEARCH_SMALL_MODEL": "gpt-4o-mini",
        "OPENAI_API_KEY": "…"
      }
    }
  }
}
```

## Notes / TODO

- Add mocked integration tests for Brave + LLM calls.
- Add richer Brave parameter support (and better date/freshness UX).
- Consider on-disk cache for large file conversions.

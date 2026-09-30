# Deep AI Search

AI-powered web search and deep-content fetching for research-heavy tasks.

Treat this the SAME as any Web Search tool. Use it only when necessary.

## Available tools

### `search`
Breadth-first web search using Brave Search, domain diversity, and optionally AI query expansion/relevance filtering when enabled in config.

Use it when you want:
- broad research across many candidate sources
- result curation before opening specific pages
- allow/block domain controls
- freshness, country, language, or safesearch tuning via `brave_params`

Key inputs:
- `query`
- `breadth` (0-10)
- `domain_allowlist`
- `domain_blocklist`
- `brave_params`

### `fetch`
Depth-first retrieval for a single URL.

Use it when you want:
- readable markdown extracted from a page
- smart chunk selection for long content when enabled in config
- optional AI synthesis over fetched content when enabled in config
- image and file handling from the target URL

Key inputs:
- `url`
- `depth` (0-10)
- `smart_mode` (only when AI features are enabled)
- `ai_mode` (only when AI features are enabled)
- `prompt` (only when AI features are enabled)

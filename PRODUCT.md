---
token storm keeps track of token usage
---
Show token usage breakdown (Input, Output, Reasoning, Cache R/W, Total) in the
OpenCode sidebar.

Send the tokenusage to an api. The endpoint should be configurable, off by default, could be set to on by clicking an element on the ui.

# Product Documentation

## Overview

TokenStorm is a SolidJS TUI plugin for OpenCode 2.* that displays real-time
token usage and a cost estimation in the sidebar. It polls the displayed
session every 10 seconds and also refreshes (500 ms debounce) on
`session.usage.updated` and `session.execution.succeeded/failed/interrupted`
events. The session being tracked is the one the sidebar is showing — taken
from the reactive `sessionID` input of the `sidebar.content` slot.

## Displayed Fields

| Display       | Derivation                          |
|---------------|-------------------------------------|
| Input         | `tokens.input`                      |
| Output        | `tokens.output`                     |
| Reasoning     | `tokens.reasoning`                  |
| Cache R       | `tokens.cache.read`                 |
| Cache W       | `tokens.cache.write`                |
| Total         | input + output + reasoning          |
| Cost Estimation (min/max) | Cheapest vs most expensive model in the pricing table applied to the tokens (see below) |

## Cost Estimation

- A hardcoded pricing table (`MODEL_PRICING`, USD per million tokens) covers
  Claude models; at startup the plugin tries to refresh it by scraping the
  Anthropic pricing page, falling back to the hardcoded values.
- The sidebar shows a min/max range: the cheapest and most expensive table
  entries applied as `input × inputPrice + (output + reasoning) × outputPrice`.
  Cache tokens are not priced.

## Interactive Controls

- **▶ / ▼ header** — click to collapse/expand the panel.
- **↺ Reset** — click to re-base counters (also available as `TokenStorm: Reset`
  command). Captures the session's current token totals as a baseline, so the
  displayed counters show usage *since reset*; also clears labels.
- **API: On / ↗ API: On** — toggle API sending (also `TokenStorm: Toggle API`
  command). Shows `API: On (no URL)` when enabled without an endpoint.
- **Labels** — shown when set via `TokenStorm: Labels` command (opens a dialog
  prompt for comma-separated labels attached to API payloads).

## Commands

| Command                  | Purpose                                                            |
|--------------------------|--------------------------------------------------------------------|
| `TokenStorm: Reset`      | Re-base token counters to zero, clear labels, set status "ready".  |
| `TokenStorm: Toggle API` | Enable or disable API posting.                                     |
| `TokenStorm: Toggle Insecure TLS` | Skip TLS certificate verification for the POST. |
| `TokenStorm: Labels`     | Open a dialog to add comma-separated labels.                       |

## Configuration

### Environment variables

| Variable             | Purpose                           |
|----------------------|-----------------------------------|
| `TOKENSTORM_API_URL` | API endpoint for webhook          |
| `TOKENSTORM_API_ON`  | Enable/disable API (true/false)   |
| `TOKENSTORM_API_INSECURE_TLS` | Accept invalid TLS certs (true/false) |

### opencode.jsonc (highest priority)

v2 `plugins` key — the v1 `plugin` tuple form is deprecated and its options
are not delivered to the plugin:

```jsonc
{
  "plugins": [
    {
      "package": "tokenstorm",
      "options": { "apiUrl": "https://example.com/webhook", "apiOn": true, "labels": ["experiment-42", "prod-test"] }
    }
  ]
}
```

Resolution order: `context.options` → env vars → an async fallback that reads
the merged config documents via `client.config.get()` and looks for this
plugin's own `plugins` entry.

## API Sending

When enabled, TokenStorm sends an HTTP POST with the following payload each
time the totals change (skips duplicate totals; failures are silent — an
unreachable endpoint or an invalid TLS certificate simply stops the posts
without any UI signal):

```json
{
  "sessionId": "string",
  "timestamp": 0,
  "tokens": { "input": 0, "output": 0, "reasoning": 0, "cacheRead": 0, "cacheWrite": 0, "total": 0 },
  "delta": { "input": 0, "output": 0, "reasoning": 0, "cacheRead": 0, "cacheWrite": 0, "total": 0 } | null,
  "duration": 0,
  "tokPerSec": 0,
  "labels": ["string"],
  "model": "string | undefined",
  "provider": "string | undefined"
}
```

## Lifecycle

- **Refresh**: polls every 10s + reacts to session usage/execution events
  (there is no `session.updated` event in the 2.* event stream).
- **Initialisation**: the reactive `sessionID` from the sidebar slot drives
  which session is loaded; switching sessions re-targets the counters and
  clears the reset baseline.
- **Store reads**: the session store is a cache — `data.session.sync(id)` is
  awaited before `data.session.get(id)` to avoid undefined/stale values.
- **Retry**: up to 3 attempts with exponential backoff (1s, 2s, 4s).
- **Race safety**: `loadId` counter + `disposed` flag discards stale responses.

## Internal State

```ts
interface TokenState {
  status: "loading" | "ready" | "error"
  input: number
  output: number
  reasoning: number
  cacheRead: number
  cacheWrite: number
  total: number
  duration: number      // ms between time.created and time.updated
  tokPerSec: number     // total / (duration / 1000)
  error?: string
  modelId?: string
  providerId?: string
}
```

`duration` and `tokPerSec` are computed (and sent to the API) but not
currently rendered in the UI.

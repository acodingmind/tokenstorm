---
token storm keeps track of token usage
---
Show token usage breakdown (Input, Output, Reasoning, Cache R/W, Total) and
estimated cost range (min/max Claude models) in the OpenCode sidebar.

Send the tokenusage to an api. The endpoint should be configurable, off by default, could be set to on by clicking an element on the ui.

# Product Documentation

## Overview

TokenStorm is a SolidJS TUI plugin for OpenCode that displays real-time token
usage and estimated cost in the sidebar. It polls the active session every
10 seconds and reacts to `session.created`, `session.updated`, and
`tui.session.select` events.

## Displayed Fields

| Display       | Derivation                          |
|---------------|-------------------------------------|
| Input         | `tokens.input`                      |
| Output        | `tokens.output`                     |
| Reasoning     | `tokens.reasoning`                  |
| Cache R       | `tokens.cache.read`                 |
| Cache W       | `tokens.cache.write`                |
| Total         | input + output + reasoning          |
| min cost      | cheapest Claude model × counts      |
| max cost      | most expensive Claude model × counts|

## Cost Estimation

Costs are estimated using Claude model pricing:

- **Static fallback**: Hardcoded `MODEL_PRICING` map (~15 Claude models).
- **Web refresh**: On plugin load, fetches Anthropic's pricing page and updates
  matching entries. Silently fails back to the hardcoded map on errors.
- **Lookup**: Exact match first, then longest-prefix match (e.g.
  `claude-sonnet-4-20250514` matches `claude-sonnet-4`).
- **Formula**: `(input / 1_000_000) * pricing.input + (output + reasoning) / 1_000_000 * pricing.output`
- **Range**: Cheapest and most expensive models are computed once from the
  hardcoded map as a cost range indicator.

## Interactive Controls

- **↺ Reset** — click to zero all counters (also available as `TokenStorm: Reset` command).
- **API: On / ↗ API: On** — toggle API sending (also `TokenStorm: Toggle API` command).
- **Labels** — shown when set via `TokenStorm: Labels` command (opens a dialog
  prompt for comma-separated labels attached to API payloads).

## Commands

| Command                  | Purpose                                                |
|--------------------------|--------------------------------------------------------|
| `TokenStorm: Reset`      | Zero all token counters, set status to "ready".        |
| `TokenStorm: Toggle API` | Enable or disable API posting.                         |
| `TokenStorm: Labels`     | Open a dialog to add comma-separated labels.           |

## Configuration

### Environment variables

| Variable         | Purpose                      |
|------------------|------------------------------|
| `TOKENSTORM_API_URL` | API endpoint for webhook |
| `TOKENSTORM_API_ON`  | Enable/disable API (true/false) |
| `TOKENSTORM_LABELS`    | Comma-separated labels     |

### opencode.jsonc (highest priority)

```jsonc
{
  "plugin": [
    ["tokenstorm", { "apiUrl": "https://example.com/webhook", "apiOn": true, "labels": ["experiment-42", "prod-test"] }]
  ]
}
```

## API Sending

When enabled, TokenStorm sends HTTP POST requests with the following payload:

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

- **Refresh**: Polls every 10s + reacts to session events.
- **Initialisation**: On mount, reads `api.route.current` — if on a session
  route, loads that session immediately; otherwise shows zeros.
- **Retry**: Up to 3 attempts with exponential backoff (1s, 2s, 4s).
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

`duration` and `tokPerSec` are computed but not currently rendered in the UI.

# tokenstorm — OpenCode TUI plugin

SolidJS plugin (TUI in `tui.tsx`) showing token usage + cost estimation in the
OpenCode sidebar. No build step — `.tsx` consumed directly at runtime. Pure
helpers live in `token-utils.ts` (unit-tested with vitest).

## Commands

| Command                | Purpose                                   |
|------------------------|-------------------------------------------|
| `bun --watch tui.tsx`  | dev with hot-reload                       |
| `npm test`             | run unit tests (vitest)                   |
| `npm run typecheck`    | typecheck with `tsc --noEmit`             |

## Architecture

- **Entrypoints**: `tui.tsx` default-exports `Plugin.define({ id, setup })`
  (from `@opencode/plugin/tui`); `index.ts` is a minimal server-side plugin
  stub (`@opencode/plugin`) — the TUI part is loaded via the `./tui` export.
- **Discovery**: `"oc-plugin": ["tui"]` in `package.json` — host uses this to
  find the plugin.
- **Exports**: `"."` → `./index.ts` (server), `"./tui"` → `./tui.tsx` (TUI).
- **Module**: ESM (`"type": "module"`).
- **Plugin import**: `@opencode/plugin` / `@opencode/plugin/tui` (OpenCode 2.*
  package; subpath for the TUI API).
- **JSX**: `@opentui/solid` import source (NOT `solid-js`). Enforced by both
  `tsconfig.json` `jsxImportSource` and the
  `/** @jsxImportSource @opentui/solid */` pragma in `tui.tsx`.
- **Slot**: `context.ui.slot({ append: "sidebar.content" })` — the slot's
  reactive `sessionID` prop drives which session is displayed.
- **Scope**: root `opencode.jsonc` references the plugin via the v2 `plugins`
  array (`"package": "./"` with an `options` object).
- **Published files**: `"files": ["tui.tsx", "index.ts", "token-utils.ts",
  "package.json", "README.md"]`.

### Displayed fields

| Display       | Derivation                          |
|---------------|-------------------------------------|
| Input         | `tokens.input`                      |
| Output        | `tokens.output`                     |
| Reasoning     | `tokens.reasoning`                  |
| Cache R       | `tokens.cache.read`                 |
| Cache W       | `tokens.cache.write`                |
| Total         | input + output + reasoning          |
| Cost min/max  | cheapest/most expensive entry of `MODEL_PRICING` applied to tokens (see Cost Estimation) |

Interactive controls in the sidebar:
- **▶ / ▼ TokenStorm** — click the header to collapse/expand the panel
- **↺ Reset** — clickable label (or `TokenStorm: Reset` command)
- **API: On / ↗ API: On** — toggle API sending (or `TokenStorm: Toggle API` command); shows `API: On (no URL)` when no endpoint is configured, and `·insecure-tls` when TLS verification is disabled
- **Labels** — shown when set via `TokenStorm: Labels` command (opens a dialog prompt to add comma-separated labels)

### Lifecycle

- **Refresh**: polls every 10s + reacts (500ms debounce) to
  `session.usage.updated` and `session.execution.*` events. There is no
  `session.updated` event in the 2.* event stream.
- **Initialisation**: the session is taken from the reactive `sessionID`
  input of the `sidebar.content` slot — the session the sidebar is showing.
  Do not use `session.list()` at setup: the local store may be empty then.
- **Store reads**: `data.session.get()` is a cache lookup and can return
  `undefined` or stale values; always `await data.session.sync(id)` first.
- **Retry**: up to 3 attempts, exponential backoff (1s, 2s, 4s).
- **Race safety**: `loadId` counter + `disposed` flag discards stale
  responses.
- **Commands**: registered via `context.keymap.layer` (global mode).
  `TokenStorm: Reset` re-bases counters, `TokenStorm: Toggle API`
  enables/disables API posting, `TokenStorm: Toggle Insecure TLS` toggles
  certificate verification for the POST, `TokenStorm: Labels` opens
  `context.ui.dialog.prompt` to set comma-separated labels attached to API
  payloads.
- **Reset**: `TokenStorm: Reset` (also a clickable `↺ Reset` label) captures
  the session's current totals as a `resetBaseline` (later reads subtract it,
  floored at 0) and clears labels, so counters show usage *since reset*. The
  baseline is cleared when the tracked session changes.

### Internal state (`TokenState`)

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

`duration` and `tokPerSec` are computed (and included in API payloads) but not
currently rendered in the UI.

### Cost Estimation

- `MODEL_PRICING` maps Claude model ids to USD-per-million input/output
  prices; `refreshPricingFromWeb()` scrapes the Anthropic pricing page at
  setup to refresh the table, with the hardcoded values as fallback.
- The sidebar renders a min/max range: the cheapest and most expensive table
  entries applied as `input × inputPrice + (output + reasoning) ×
  outputPrice` per million tokens. Cache tokens are not priced.

### API Sending

Token usage can be sent to an external API endpoint via HTTP POST. Off by
default; configure via `opencode.jsonc` or environment variables.

Resolution order: `context.options` → `TOKENSTORM_API_URL` /
`TOKENSTORM_API_ON` / `TOKENSTORM_API_INSECURE_TLS` env vars → async fallback
that reads the merged config documents via `client.config.get()` and looks for
this plugin's own `plugins` entry (fills in whatever the first two sources
left unset).

`apiInsecureTls` (also `TokenStorm: Toggle Insecure TLS`) adds Bun's
`fetch(url, { tls: { rejectUnauthorized: false } })` so posts still go out to
endpoints with expired or self-signed certificates. `sendToApi` swallows every
error, so a broken TLS chain looks identical to "sending works" in the UI —
check the certificate with `openssl s_client … | openssl x509 -noout -enddate`
before debugging anything else.

**opencode.jsonc** — v2 `plugins` key; the v1 `plugin` tuple form is
deprecated and its options are **not** delivered to `context.options`. A
copy auto-discovered from `~/.config/opencode/plugins/` also receives no
options; it must be a configured `plugins` entry.

```jsonc
{
  "plugins": [
    {
      "package": "./",
      "options": { "apiUrl": "https://example.com/webhook", "apiOn": true, "labels": ["experiment-42", "prod-test"] }
    }
  ]
}
```

Payload shape:

```json
{
  "sessionId": "string",
  "timestamp": 0,
  "tokens": {
    "input": 0, "output": 0, "reasoning": 0,
    "cacheRead": 0, "cacheWrite": 0, "total": 0
  },
  "delta": {
    "input": 0, "output": 0, "reasoning": 0,
    "cacheRead": 0, "cacheWrite": 0, "total": 0
  } | null,
  "duration": 0,
  "tokPerSec": 0,
  "labels": ["string"],
  "model": "string | undefined",
  "provider": "string | undefined"
}
```

## Dependencies

- `@opencode/plugin` — runtime dep for the server + TUI plugin API (OpenCode
  2.*).
- `@opentui/core` + `@opentui/solid` + `solid-js` — peer deps (provided by
  host; `@opentui/*` `>=0.6.6`, `solid-js` `>=1.9.0`; `@opentui/solid` and
  `solid-js` also in devDeps for typechecking).

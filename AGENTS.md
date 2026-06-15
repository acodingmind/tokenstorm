# tokenstorm — OpenCode TUI plugin

Single-file (`tui.tsx`) SolidJS plugin showing token usage in the OpenCode
sidebar. No build step — `.tsx` consumed directly at runtime.

## Commands

| Command                | Purpose                                   |
|------------------------|-------------------------------------------|
| `bun --watch tui.tsx`  | dev with hot-reload                       |
| `npx tsc --noEmit`     | typecheck (no linter, no test runner)     |

## Architecture

- **Entrypoint**: default export `{ id: "tokenstorm", tui }` as
  `TuiPluginModule`.
- **Discovery**: `"oc-plugin": ["tui"]` in `package.json` — host uses this to
  find the plugin.
- **Exports**: both `"."` and `"./tui"` map to `./tui.tsx`.
- **Module**: ESM (`"type": "module"`).
- **Plugin import**: `@opencode-ai/plugin/tui` (subpath, not top-level).
- **JSX**: `@opentui/solid` import source (NOT `solid-js`). Enforced by both
  `tsconfig.json` `jsxImportSource` and the
  `/** @jsxImportSource @opentui/solid */` pragma in `tui.tsx`.
- **Slot**: `sidebar_content` at order `130`.
- **Scope**: `.opencode/opencode.json` references the plugin via top-level
  `"plugin"` array pointing at a local path.
- **Published files**: `"files": ["tui.tsx", "package.json", "README.md"]`.

### Displayed fields

| Display       | Derivation                          |
|---------------|-------------------------------------|
| Input         | `tokens.input`                      |
| Output        | `tokens.output`                     |
| Reasoning     | `tokens.reasoning`                  |
| Cache R       | `tokens.cache.read`                 |
| Cache W       | `tokens.cache.write`                |
| Total         | input + output + reasoning          |

Interactive controls in the sidebar:
- **↺ Reset** — clickable label (or `TokenStorm: Reset` command)
- **API: On / ↗ API: On** — toggle API sending (or `TokenStorm: Toggle API` command)
- **Labels** — shown when set via `TokenStorm: Labels` command (opens a dialog prompt to add comma-separated labels)

### Lifecycle

- **Refresh**: polls every 10s + reacts to `session.created`,
  `session.updated`, `tui.session.select`.
- **Initialisation**: On mount, reads `api.route.current` — if on a session
  route, loads that session immediately; otherwise shows zeros.
- **Retry**: up to 3 attempts, exponential backoff (1s, 2s, 4s).
- **Race safety**: `loadId` counter + `disposed` flag discards stale
  responses.
- **Commands**: `TokenStorm: Reset` zeroes counters, `TokenStorm: Toggle API`
  enables/disables API posting, `TokenStorm: Labels` opens a `DialogPrompt` to
  add comma-separated labels attached to API payloads.
- **Reset**: `TokenStorm: Reset` command (via `api.command.register`) zeroes
  all counters and sets status to `"ready"`. Also exposed as a clickable
  `↺ Reset` label in the sidebar.

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

`duration` and `tokPerSec` are computed but not currently rendered in the UI.

### `.opencode/` subtree

Used by the OpenCode host for its own plugin resolution:

```
.opencode/
  .gitignore         — ignores node_modules, package files, bun.lock
  opencode.json      — plugin list (just ["list"])
  package.json       — pins @opencode-ai/plugin (dev dependency for the host)
```

### API Sending

Token usage can be sent to an external API endpoint via HTTP POST. Off by
default; configure via `opencode.jsonc` or environment variables.

**opencode.jsonc** (highest priority):

```jsonc
{
  "plugin": [
    ["tokenstorm", { "apiUrl": "https://example.com/webhook", "apiOn": true, "labels": ["experiment-42", "prod-test"] }]
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

- `@opencode-ai/plugin` — runtime dep for TUI plugin API.
- `@opentui/solid` + `solid-js` — peer deps (provided by host, in devDeps for
  typechecking). Note: `@opentui/solid` peer constraint is `^0.3.2`, devDep is
  `^0.4.1`.

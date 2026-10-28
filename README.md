# TokenStorm

[![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)](https://github.com/acodingmind/tokenstorm/blob/main/LICENSE)

OpenCode TUI plugin that displays a full token usage breakdown (Input, Output,
Reasoning, Cache R/W, Total) and a cost estimation in the sidebar — with
optional webhook reporting of usage to an external API.

Repo: <https://github.com/acodingmind/tokenstorm>

Requires OpenCode 2.*.

## Install

```sh
opencode plugin add github:acodingmind/tokenstorm
```

Or add an entry to the v2 `plugins` key in your config
(`~/.config/opencode/opencode.jsonc` or the project's `opencode.jsonc`):

```jsonc
{
  "plugins": [
    {
      "package": "tokenstorm",
      "options": {
        "apiUrl": "https://example.com/webhook",
        "apiOn": true,
        "labels": ["experiment-42"]
      }
    }
  ]
}
```

> The v1 `"plugin"` key is deprecated and its options are **not** delivered to
> the plugin — use `plugins` so options arrive.

Discovery uses `"oc-plugin": ["tui"]` in `package.json` — no additional config
required. Once added, **TokenStorm** appears in the right sidebar panel.
Full install/verification/uninstall guide: [INSTALL.md](INSTALL.md).

## Usage

The plugin polls the displayed session every 10 seconds, refreshes on session
usage/execution events, and shows:

| Field            | Source                                |
|------------------|---------------------------------------|
| Input            | `tokens.input`                        |
| Output           | `tokens.output`                       |
| Reasoning        | `tokens.reasoning`                    |
| Cache R          | `tokens.cache.read`                   |
| Cache W          | `tokens.cache.write`                  |
| Total            | input + output + reasoning            |
| Cost Estimation  | min/max price range across Claude models for your tokens |

Interactive controls:

- **▶ / ▼ TokenStorm** — click the header to collapse/expand the panel.
- **↺ Reset** — click to count from zero again (clears the baseline and labels;
  previously accumulated tokens are subtracted, the session itself is not
  reset).
- **API: Off / On** — click to toggle webhook sending.
- **Labels** — shown next to the API status when set.

| Command                  | Purpose                                              |
|--------------------------|------------------------------------------------------|
| `TokenStorm: Reset`      | Re-base counters to zero and clear labels.           |
| `TokenStorm: Toggle API` | Enable or disable API posting.                       |
| `TokenStorm: Toggle Insecure TLS` | Skip TLS cert verification for POSTs.     |
| `TokenStorm: Labels`     | Set comma-separated labels attached to API payloads. |

## API Sending

Off by default. When enabled (config, env var, or clicking the API status),
the plugin POSTs a JSON payload with token totals, deltas since the last
send, duration, labels, and model/provider info to `apiUrl`. Payload shape and
product details: [PRODUCT.md](PRODUCT.md).

Configuration options (`options` in the `plugins` entry):

| Option   | Type     | Meaning                                        |
|----------|----------|------------------------------------------------|
| `apiUrl` | string   | POST endpoint for token usage payloads         |
| `apiOn`  | boolean  | Start with API sending enabled (default false) |
| `labels` | string[] | Labels attached to API payloads                |
| `apiInsecureTls` | boolean | Send even when the endpoint's TLS certificate is invalid (expired / self-signed). Off by default |

Environment fallbacks: `TOKENSTORM_API_URL`, `TOKENSTORM_API_ON`,
`TOKENSTORM_API_INSECURE_TLS`. Toggle at runtime with the
`TokenStorm: Toggle Insecure TLS` command; the sidebar marks the state as
`↗ API: On ·insecure-tls`. Use it only as a stopgap — renewing the endpoint's
certificate is the real fix.

Send failures are not surfaced in the UI (expired certificates, connection
errors and non-2xx responses all fail silently). When nothing arrives at the
endpoint, check the certificate first:

```sh
openssl s_client -connect api.example.com:443 -servername api.example.com </dev/null \
  | openssl x509 -noout -enddate
```

## Development

```sh
git clone <url>
cd tokenstorm
bun install          # or npm install
bun --watch tui.tsx  # hot-reload dev
npm test             # unit tests (vitest)
npm run typecheck    # tsc --noEmit
```

## Docs

- [INSTALL.md](INSTALL.md) — installation & configuration
- [PRODUCT.md](PRODUCT.md) — product spec: features, payload, lifecycle
- [AGENTS.md](AGENTS.md) — architecture notes for contributors/agents

## License

MIT

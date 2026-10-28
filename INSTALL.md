# Installation

OpenCode v2 only. The v1 `"plugin": [...]` config key is deprecated and its
options objects are ignored — use the v2 `"plugins"` key below so the plugin
receives its options.

## From GitHub

```sh
opencode plugin add github:acodingmind/tokenstorm
```

To pass options, add an entry to `plugins` in `~/.config/opencode/opencode.jsonc`
(or the project's `opencode.jsonc`):

```jsonc
{
  "plugins": [
    {
      "package": "tokenstorm",
      "options": {
        "apiUrl": "https://example.com/webhook",
        "apiOn": true,
        "labels": ["my-label"]
      }
    }
  ]
}
```

## From a local checkout

Point `plugins` at the plugin directory (relative paths resolve from the config
file):

```jsonc
{
  "plugins": [
    {
      "package": "./path/to/tokenstorm",
      "options": { "apiUrl": "https://example.com/webhook", "apiOn": true }
    }
  ]
}
```

Note: simply placing the directory in `~/.config/opencode/plugins/` loads the
plugin but passes **no options** — use a `plugins` entry for that.

## Configuration

| Option   | Type       | Meaning                                        |
|----------|------------|------------------------------------------------|
| `apiUrl` | string     | POST endpoint for token usage payloads         |
| `apiOn`  | boolean    | Start with API sending enabled (default false) |
| `labels` | string[]   | Labels attached to API payloads                |
| `apiInsecureTls` | boolean | Skip TLS certificate verification for the POST (stopgap for expired / self-signed certs) |

Environment fallbacks: `TOKENSTORM_API_URL`, `TOKENSTORM_API_ON`,
`TOKENSTORM_API_INSECURE_TLS`.

## Verification

After installing, restart OpenCode (`opencode service restart` if running as a
service). **TokenStorm** should appear in the right sidebar panel showing token
usage breakdown. Run `opencode plugin list` to confirm the plugin resolves to
the location you expect.

## Uninstall

Remove the `tokenstorm` entry from `plugins` (or `opencode plugin remove
tokenstorm` for global installs) and restart OpenCode.

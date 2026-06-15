# TokenStorm

OpenCode TUI plugin that displays a full token usage breakdown (Input, Output,
Reasoning, Cache R/W, Total) and estimated cost range in the sidebar.

## Install

### Local path (development)

```jsonc
{
  "plugin": ["./tui.tsx"]
}
```

### npm (once published)

```jsonc
{
  "plugin": ["tokenstorm"]
}
```

Discovery uses `"oc-plugin": ["tui"]` in `package.json` — no additional config
required. Once added, **TokenStorm** appears in the right sidebar panel.

## Usage

The plugin polls the active session every 10 seconds and displays:

| Field       | Source                                |
|-------------|---------------------------------------|
| Input       | `tokens.input`                        |
| Output      | `tokens.output`                       |
| Reasoning   | `tokens.reasoning`                    |
| Cache R     | `tokens.cache.read`                   |
| Cache W     | `tokens.cache.write`                  |
| Total       | input + output + reasoning            |
| min cost    | cheapest Claude model × token counts  |
| max cost    | most expensive Claude model × counts   |

Costs are estimated using hardcoded Claude pricing (refreshed from
[Anthropic's pricing page](https://docs.anthropic.com/en/docs/about-claude/pricing)
on plugin load). Click **↺ Reset** (or run the `TokenStorm: Reset` command) to
zero all counters.

Reactively updates on `session.created`, `session.updated`, and
`tui.session.select` events.

## Development

```sh
git clone <url>
cd tokenstorm
bun install          # or npm install
bun --watch tui.tsx  # hot-reload dev
npx tsc --noEmit     # typecheck
```

## License

MIT

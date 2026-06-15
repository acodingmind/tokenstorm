# Installation

## From GitHub

Add the plugin to your `~/.config/opencode/opencode.json`:

### Direct git URL

```jsonc
{
  "plugin": ["git+https://github.com/acodingmind/tokenstorm.git"]
}
```

### npm install from GitHub

```sh
npm install tokenstorm
```

Then in `opencode.json`:

```jsonc
{
  "plugin": ["tokenstorm"]
}
```

### Bun install from GitHub

```sh
bun add tokenstorm
```

Then in `opencode.json`:

```jsonc
{
  "plugin": ["tokenstorm"]
}
```

## Configuration

No additional configuration required. The plugin auto-discovers via the
`"oc-plugin": ["tui"]` field in `package.json`.

## Verification

After installing, restart OpenCode. **TokenStorm** should appear in the right
sidebar panel showing token usage breakdown.

## Uninstall

Remove `"tokenstorm"` (or the git URL) from the `"plugin"` array in
`opencode.json` and restart OpenCode.

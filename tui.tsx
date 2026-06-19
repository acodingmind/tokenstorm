/** @jsxImportSource @opentui/solid */

import type { TuiPlugin, TuiPluginApi, TuiPluginModule } from "@opencode-ai/plugin/tui"
import { Show, createEffect, createSignal, onCleanup } from "solid-js"
import type { TokenState } from "./token-utils"
import { computeTotal, computeTokPerSec, zeroTokenState, applyBaseline, toSnapshot } from "./token-utils"

const id = "tokenstorm"
const SIDEBAR_ORDER = 130
const REFRESH_MS = 10_000
const MAX_RETRIES = 3
const RETRY_DELAY_MS = 1_000

function formatCount(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, "") + "M"
  if (n >= 1_000) return (n / 1_000).toFixed(1).replace(/\.0$/, "") + "K"
  return n.toLocaleString()
}

function formatDuration(ms: number): string {
  if (ms < 1_000) return "<1s"
  const sec = ms / 1_000
  if (sec < 60) return sec.toFixed(1) + "s"
  const min = Math.floor(sec / 60)
  const rem = Math.floor(sec % 60)
  if (min < 60) return `${min}m ${rem}s`
  const hr = Math.floor(min / 60)
  return `${hr}h ${min % 60}m`
}

function readPluginOptions(api: TuiPluginApi, options: Record<string, unknown> | undefined): Record<string, unknown> {
  if (options && typeof options === "object" && Object.keys(options).length > 0) {
    return options
  }
  const sources = [
    (api as any).state?.config?.plugin,
    (api as any).tuiConfig?.plugin,
  ]
  for (const plugins of sources) {
    if (!Array.isArray(plugins)) continue
    for (const entry of plugins) {
      if (Array.isArray(entry) && entry[0] === id && entry[1] && typeof entry[1] === "object") {
        return entry[1] as Record<string, unknown>
      }
    }
  }
  return {}
}

const tui: TuiPlugin = async (api, options) => {
  const configObj = readPluginOptions(api, options as Record<string, unknown> | undefined)
  const configApiUrl: string | undefined = "apiUrl" in configObj && configObj.apiUrl != null && configObj.apiUrl !== "" ? String(configObj.apiUrl) : undefined
  const configApiOn: boolean | undefined = "apiOn" in configObj ? String(configObj.apiOn ?? "") === "true" : undefined
  const configLabels: string[] | undefined = "labels" in configObj && Array.isArray(configObj.labels)
    ? configObj.labels.map(String)
    : undefined

  // Environment variable fallbacks (AGENTS.md documents this as supported)
  const envApiUrl =
    typeof process !== "undefined" && process.env?.TOKENSTORM_API_URL
      ? String(process.env.TOKENSTORM_API_URL)
      : undefined
  const envApiOn =
    typeof process !== "undefined" &&
    process.env?.TOKENSTORM_API_ON != null &&
    process.env.TOKENSTORM_API_ON !== ""
      ? String(process.env.TOKENSTORM_API_ON) === "true"
      : undefined

  // Options take precedence over env vars; env vars take precedence over defaults
  const finalApiUrl = configApiUrl ?? envApiUrl
  const finalApiOn = configApiOn ?? envApiOn
  let disposed = false
  let loadId = 0
  let lastSessionId = ""

  const [collapsed, setCollapsed] = createSignal(false)
  const [apiUrl, setApiUrl] = createSignal(finalApiUrl)
  const [apiEnabled, setApiEnabled] = createSignal(finalApiOn !== undefined ? finalApiOn : false)
  const [labels, setLabels] = createSignal<string[]>(configLabels ?? [])

  let prevTokens: { input: number; output: number; reasoning: number; cacheRead: number; cacheWrite: number; total: number } | null = null
  let lastSentTotal = -1

  async function sendToApi(tokenState: TokenState) {
    if (!apiEnabled() || !apiUrl()) return
    if (tokenState.total === lastSentTotal) return
    try {
      const delta = prevTokens ? {
        input: tokenState.input - prevTokens.input,
        output: tokenState.output - prevTokens.output,
        reasoning: tokenState.reasoning - prevTokens.reasoning,
        cacheRead: tokenState.cacheRead - prevTokens.cacheRead,
        cacheWrite: tokenState.cacheWrite - prevTokens.cacheWrite,
        total: tokenState.total - prevTokens.total,
      } : null

      await fetch(apiUrl()!, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: lastSessionId,
          timestamp: Date.now(),
          tokens: {
            input: tokenState.input,
            output: tokenState.output,
            reasoning: tokenState.reasoning,
            cacheRead: tokenState.cacheRead,
            cacheWrite: tokenState.cacheWrite,
            total: tokenState.total,
          },
          delta,
          duration: tokenState.duration,
          tokPerSec: tokenState.tokPerSec,
          labels: labels(),
          model: tokenState.modelId || undefined,
          provider: tokenState.providerId || undefined,
        }),
      })

      prevTokens = {
        input: tokenState.input,
        output: tokenState.output,
        reasoning: tokenState.reasoning,
        cacheRead: tokenState.cacheRead,
        cacheWrite: tokenState.cacheWrite,
        total: tokenState.total,
      }
      lastSentTotal = tokenState.total
    } catch {
      // silently fail
    }
  }
  let resetBaseline: { input: number; output: number; reasoning: number; cacheRead: number; cacheWrite: number; total: number } | null = null

  const [state, setState] = createSignal<TokenState>({ ...zeroTokenState(), status: "loading" })

  function reset() {
    prevTokens = null
    resetBaseline = null
    lastSentTotal = -1
    setLabels([])

    const session = lastSessionId ? api.state.session.get(lastSessionId) : null
    const tokens = session?.tokens

    if (tokens) {
      resetBaseline = toSnapshot(tokens)
    }

    setState(zeroTokenState())

    prevTokens = { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
    lastSentTotal = 0
  }



  const unregCommand = api.command?.register(() => [
    {
      title: "TokenStorm: Reset",
      value: "tokenstorm.reset",
      description: "Reset token counters to zero",
      category: "TokenStorm",
      onSelect: () => reset(),
    },
    {
      title: `TokenStorm: Toggle API (currently ${apiEnabled() ? "On" : "Off"})`,
      value: "tokenstorm.toggleApi",
      description: "Enable or disable sending token usage to the API endpoint",
      category: "TokenStorm",
      onSelect: () => setApiEnabled(!apiEnabled()),
    },
    {
      title: `TokenStorm: API URL ${apiUrl() || "(not set)"}`,
      value: "tokenstorm.setApiUrl",
      description: "Set via apiUrl in opencode.jsonc",
      category: "TokenStorm",
      onSelect: () => {
        // no prompt API available; set via apiUrl in opencode.jsonc
      },
    },
    {
      title: `TokenStorm: Labels${labels().length ? ` (${labels().join(", ")})` : " (not set)"}`,
      value: "tokenstorm.setLabels",
      description: "Add or remove labels to mark API payloads with",
      category: "TokenStorm",
      onSelect: (dialog) => {
        if (!dialog) return
        const current = labels()
        dialog.replace(() => (
          <api.ui.DialogPrompt
            title="TokenStorm Labels"
            placeholder="e.g. experiment-42 (comma-separated)"
            value={current.join(", ")}
            onConfirm={(value) => {
              const newLabels = value.split(",").map((s) => s.trim()).filter(Boolean)
              setLabels(newLabels)
              dialog.clear()
            }}
            onCancel={() => dialog.clear()}
          />
        ))
      },
    },
  ])

  async function load(sessionId: string) {
    if (disposed || !sessionId) return
    const myLoadId = ++loadId

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const session = api.state.session.get(sessionId)
        if (disposed || myLoadId !== loadId) return

        const tokens = session?.tokens
        const time = session?.time
        const model = session?.model
        let duration = 0
        if (time?.created && time?.updated && time.updated > time.created) {
          duration = time.updated - time.created
        }

        if (tokens) {
          const raw = {
            input: tokens.input ?? 0,
            output: tokens.output ?? 0,
            reasoning: tokens.reasoning ?? 0,
            cacheRead: tokens.cache?.read ?? 0,
            cacheWrite: tokens.cache?.write ?? 0,
          }
          const adjusted = resetBaseline ? applyBaseline(raw, resetBaseline) : raw
          const total = computeTotal(adjusted.input, adjusted.output, adjusted.reasoning)
          const s = {
            status: "ready" as const,
            input: adjusted.input,
            output: adjusted.output,
            reasoning: adjusted.reasoning,
            cacheRead: adjusted.cacheRead,
            cacheWrite: adjusted.cacheWrite,
            total,
            duration,
            tokPerSec: computeTokPerSec(total, duration),
            modelId: model?.id,
            providerId: model?.providerID,
          }
          setState(s)
          sendToApi(s)
        } else {
          const s = {
            ...zeroTokenState(),
            duration,
            modelId: model?.id,
            providerId: model?.providerID,
          }
          setState(s)
          sendToApi(s)
        }
        return
      } catch (e: unknown) {
        if (attempt < MAX_RETRIES) {
          await new Promise((r) =>
            setTimeout(r, RETRY_DELAY_MS * Math.pow(2, attempt)),
          )
          if (disposed || myLoadId !== loadId) return
        } else {
          setState({ ...zeroTokenState(), status: "error", error: e instanceof Error ? e.message : "Failed to load" })
        }
      }
    }
  }

  // Initialize with current session from route
  const route = api.route.current
  if (route.name === "session" && route.params) {
    lastSessionId = route.params.sessionID as string
    load(lastSessionId)
  } else if (api.state.ready) {
    // No active session and state is ready — show zeros instead of Loading
    setState(zeroTokenState())
  } else {
    // No active session and state not ready yet — poll until ready
    const checkReady = setInterval(() => {
      if (api.state.ready) {
        clearInterval(checkReady)
        setState(zeroTokenState())
      }
    }, 500)
    onCleanup(() => clearInterval(checkReady))
  }

  createEffect(() => {
    const interval = setInterval(() => {
      if (lastSessionId) load(lastSessionId)
    }, REFRESH_MS)

    const u1 = api.event.on("session.created", (e) => {
      const sid = e?.properties?.sessionID
      if (sid) {
        lastSessionId = sid
        load(sid)
      }
    })
    const u2 = api.event.on("session.updated", (e) => {
      const sid = e?.properties?.sessionID
      if (sid) {
        lastSessionId = sid
        load(sid)
      }
    })
    const u3 = api.event.on("tui.session.select", (e) => {
      const newSid = e?.properties?.sessionID
      if (newSid) {
        resetBaseline = null
        lastSessionId = newSid
        load(newSid)
      }
    })

    onCleanup(() => {
      disposed = true
      clearInterval(interval)
      u1()
      u2()
      u3()
      unregCommand?.()
    })
  })

  api.slots.register({
    order: SIDEBAR_ORDER,
    slots: {
      sidebar_content() {
        const c = collapsed
        return (
          <box gap={0}>
            <text
              fg={api.theme.current.text}
              onMouseDown={() => setCollapsed(!c())}
            >
              {c() ? "▶" : "▼"} <b>TokenStorm</b>
            </text>

            <Show when={!c()}>
              <Show when={state().status === "loading"}>
                <text fg={api.theme.current.textMuted}>Loading…</text>
              </Show>

              <Show when={state().status === "error"}>
                <text fg={api.theme.current.error}>
                  {state().error || "Unknown error"}
                </text>
              </Show>

              <Show when={state().status === "ready"}>
                <box gap={0}>
                  <text fg={api.theme.current.textMuted}>
                    Input     {formatCount(state().input)} tok
                  </text>
                  <text fg={api.theme.current.textMuted}>
                    Output    {formatCount(state().output)} tok
                  </text>
                  <text fg={api.theme.current.textMuted}>
                    Reasoning {formatCount(state().reasoning)} tok
                  </text>
                  <text fg={api.theme.current.textMuted}>
                    Cache R   {formatCount(state().cacheRead)} tok
                  </text>
                  <text fg={api.theme.current.textMuted}>
                    Cache W   {formatCount(state().cacheWrite)} tok
                  </text>
                  <box flexDirection="row">
                    <text fg={api.theme.current.text}>
                      Total     {formatCount(state().total)} tok
                    </text>
                    <text fg={api.theme.current.textMuted}> · </text>
                    <text
                      fg={api.theme.current.textMuted}
                      onMouseDown={() => reset()}
                    >
                      ↺ Reset
                    </text>
                  </box>
                  <box flexDirection="row">
                    <text
                      fg={api.theme.current.textMuted}
                      onMouseDown={() => setApiEnabled(!apiEnabled())}
                    >
                      {apiEnabled() && apiUrl() ? "↗ API: On" : "API: Off"}
                    </text>
                  </box>

                  <Show when={labels().length > 0}>
                    <box flexDirection="row">
                      {labels().map((l) => (
                        <text fg={api.theme.current.textMuted}> · {l}</text>
                      ))}
                    </box>
                  </Show>
                </box>
              </Show>
            </Show>
          </box>
        )
      },
    },
  })
}

const pluginModule: TuiPluginModule & { id: string } = {
  id,
  tui,
}

export default pluginModule

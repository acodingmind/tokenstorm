/** @jsxImportSource @opentui/solid */

import type { TuiPlugin, TuiPluginApi, TuiPluginModule } from "@opencode-ai/plugin/tui"
import { Show, createEffect, createSignal, onCleanup } from "solid-js"

const id = "tokenstorm"
const SIDEBAR_ORDER = 130
const REFRESH_MS = 10_000
const MAX_RETRIES = 3
const RETRY_DELAY_MS = 1_000

interface ModelPricing {
  input: number
  output: number
}

const MODEL_PRICING: Record<string, ModelPricing> = {
  "claude-fable-5": { input: 10, output: 50 },
  "claude-mythos-5": { input: 10, output: 50 },
  "claude-opus-4-8": { input: 5, output: 25 },
  "claude-opus-4-7": { input: 5, output: 25 },
  "claude-opus-4-6": { input: 5, output: 25 },
  "claude-opus-4-5": { input: 5, output: 25 },
  "claude-sonnet-4-6": { input: 3, output: 15 },
  "claude-sonnet-4-5": { input: 3, output: 15 },
  "claude-sonnet-4": { input: 3, output: 15 },
  "claude-haiku-4-5": { input: 1, output: 5 },
  "claude-3-5-haiku": { input: 0.8, output: 4 },
  "claude-opus-4-1": { input: 15, output: 75 },
  "claude-opus-4": { input: 15, output: 75 },
}

const PRICING_ENTRIES = Object.entries(MODEL_PRICING)
const CHEAPEST = PRICING_ENTRIES.reduce((a, b) =>
  a[1].input + a[1].output < b[1].input + b[1].output ? a : b,
)
const EXPENSIVE = PRICING_ENTRIES.reduce((a, b) =>
  a[1].input + a[1].output > b[1].input + b[1].output ? a : b,
)

const PRICING_URL = "https://docs.anthropic.com/en/docs/about-claude/pricing"

const DISPLAY_NAME_TO_ID: Record<string, string> = {
  "Claude Fable 5": "claude-fable-5",
  "Claude Mythos 5": "claude-mythos-5",
  "Claude Opus 4.8": "claude-opus-4-8",
  "Claude Opus 4.7": "claude-opus-4-7",
  "Claude Opus 4.6": "claude-opus-4-6",
  "Claude Opus 4.5": "claude-opus-4-5",
  "Claude Opus 4.1": "claude-opus-4-1",
  "Claude Opus 4": "claude-opus-4",
  "Claude Sonnet 4.6": "claude-sonnet-4-6",
  "Claude Sonnet 4.5": "claude-sonnet-4-5",
  "Claude Sonnet 4": "claude-sonnet-4",
  "Claude Haiku 4.5": "claude-haiku-4-5",
  "Claude Haiku 3.5": "claude-3-5-haiku",
}

function parsePriceValue(s: string): number | null {
  const m = s.match(/\$(\d+(?:\.\d+)?)/)
  return m ? parseFloat(m[1]) : null
}

async function refreshPricingFromWeb(): Promise<void> {
  try {
    const res = await fetch(PRICING_URL)
    if (!res.ok) return
    const text = await res.text()

    const lines = text.split("\n")
    let inPricingTable = false

    for (const rawLine of lines) {
      const line = rawLine.trim()

      if (!inPricingTable && /^\|.*Model.*Base Input.*Output.*\|/.test(line)) {
        inPricingTable = true
        continue
      }
      if (!inPricingTable) continue
      if (!line.startsWith("|")) break
      if (line.includes("---")) continue

      const parts = line.split("|").map((s) => s.trim())
      if (parts.length < 7) continue

      let name = parts[1]
      name = name.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
      const parenIdx = name.indexOf("(")
      if (parenIdx !== -1) name = name.substring(0, parenIdx)
      name = name.trim()

      if (!name.startsWith("Claude")) continue

      const inputPrice = parsePriceValue(parts[2])
      const outputPrice = parsePriceValue(parts[6])
      if (inputPrice === null || outputPrice === null) continue

      const modelId = DISPLAY_NAME_TO_ID[name]
      if (!modelId) continue

      MODEL_PRICING[modelId] = { input: inputPrice, output: outputPrice }
    }
  } catch {
    // Hardcoded MODEL_PRICING is the fallback
  }
}

function formatCost(usd: number): string {
  if (usd === 0) return "$0.00"
  if (usd < 0.0001) return "<$0.0001"
  if (usd < 1) return "$" + usd.toFixed(4)
  return "$" + usd.toFixed(2)
}

interface TokenState {
  status: "loading" | "ready" | "error"
  input: number
  output: number
  reasoning: number
  cacheRead: number
  cacheWrite: number
  total: number
  duration: number
  tokPerSec: number
  error?: string
  modelId?: string
  providerId?: string
}

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

  refreshPricingFromWeb()

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

  const [state, setState] = createSignal<TokenState>({
    status: "loading",
    input: 0,
    output: 0,
    reasoning: 0,
    cacheRead: 0,
    cacheWrite: 0,
    total: 0,
    duration: 0,
    tokPerSec: 0,
    modelId: undefined,
    providerId: undefined,
  })

  function reset() {
    prevTokens = null
    resetBaseline = null
    lastSentTotal = -1
    setLabels([])
    load(lastSessionId).then(() => {
      const s = state()
      resetBaseline = { input: s.input, output: s.output, reasoning: s.reasoning, cacheRead: s.cacheRead, cacheWrite: s.cacheWrite, total: s.total }
      setState({
        status: "ready",
        input: 0,
        output: 0,
        reasoning: 0,
        cacheRead: 0,
        cacheWrite: 0,
        total: 0,
        duration: 0,
        tokPerSec: 0,
        modelId: undefined,
        providerId: undefined,
      })
    })
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
          let input = tokens.input ?? 0
          let output = tokens.output ?? 0
          let reasoning = tokens.reasoning ?? 0
          let cacheRead = tokens.cache?.read ?? 0
          let cacheWrite = tokens.cache?.write ?? 0
          if (resetBaseline) {
            input = Math.max(0, input - resetBaseline.input)
            output = Math.max(0, output - resetBaseline.output)
            reasoning = Math.max(0, reasoning - resetBaseline.reasoning)
            cacheRead = Math.max(0, cacheRead - resetBaseline.cacheRead)
            cacheWrite = Math.max(0, cacheWrite - resetBaseline.cacheWrite)
          }
          const total = input + output + reasoning
          const s = {
            status: "ready",
            input,
            output,
            reasoning,
            cacheRead,
            cacheWrite,
            total,
            duration,
            tokPerSec: duration > 0 ? total / (duration / 1000) : 0,
            modelId: model?.id,
            providerId: model?.providerID,
          } as const
          setState(s)
          sendToApi(s)
        } else {
          const s = {
            status: "ready",
            input: 0,
            output: 0,
            reasoning: 0,
            cacheRead: 0,
            cacheWrite: 0,
            total: 0,
            duration,
            tokPerSec: 0,
            modelId: model?.id,
            providerId: model?.providerID,
          } as const
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
          setState({
            status: "error",
            input: 0,
            output: 0,
            reasoning: 0,
            cacheRead: 0,
            cacheWrite: 0,
            total: 0,
            duration: 0,
            tokPerSec: 0,
            modelId: undefined,
            providerId: undefined,
            error: e instanceof Error ? e.message : "Failed to load",
          })
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
    setState({ status: "ready", input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, total: 0, duration: 0, tokPerSec: 0, modelId: undefined, providerId: undefined })
  } else {
    // No active session and state not ready yet — poll until ready
    const checkReady = setInterval(() => {
      if (api.state.ready) {
        clearInterval(checkReady)
        setState({ status: "ready", input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, total: 0, duration: 0, tokPerSec: 0, modelId: undefined, providerId: undefined })
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
                  <text fg={api.theme.current.textMuted}>Cost Estimation</text>
                  <text fg={api.theme.current.textMuted}>
                    min ({CHEAPEST[0]}) {formatCost(
                      (state().input / 1_000_000) * CHEAPEST[1].input +
                      ((state().output + state().reasoning) / 1_000_000) * CHEAPEST[1].output,
                    )}
                  </text>
                  <text fg={api.theme.current.textMuted}>
                    max ({EXPENSIVE[0]}) {formatCost(
                      (state().input / 1_000_000) * EXPENSIVE[1].input +
                      ((state().output + state().reasoning) / 1_000_000) * EXPENSIVE[1].output,
                    )}
                  </text>
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

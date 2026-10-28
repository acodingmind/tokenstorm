/** @jsxImportSource @opentui/solid */

import { Plugin } from "@opencode/plugin/tui"
import { Show, createEffect, createSignal, onCleanup } from "solid-js"

const id = "tokenstorm"
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

function parseApiOn(value: unknown): boolean | undefined {
  if (value === undefined) return undefined
  return value === true || String(value) === "true"
}

export default Plugin.define({
  id,
  setup(context) {
    const options = (context.options ?? {}) as Record<string, unknown>

    const configApiUrl: string | undefined =
      typeof options.apiUrl === "string" && options.apiUrl !== "" ? options.apiUrl : undefined
    const configApiOn = parseApiOn(options.apiOn)
    const configApiInsecure = parseApiOn(options.apiInsecureTls)
    const configLabels: string[] | undefined = Array.isArray(options.labels)
      ? options.labels.map(String)
      : undefined

    const envApiUrl =
      typeof process !== "undefined" && process.env?.TOKENSTORM_API_URL
        ? String(process.env.TOKENSTORM_API_URL)
        : undefined
    const envApiOn =
      typeof process !== "undefined" &&
      process.env?.TOKENSTORM_API_ON != null &&
      process.env.TOKENSTORM_API_ON !== ""
        ? parseApiOn(process.env.TOKENSTORM_API_ON)
        : undefined
    const envApiInsecure =
      typeof process !== "undefined" &&
      process.env?.TOKENSTORM_API_INSECURE_TLS != null &&
      process.env.TOKENSTORM_API_INSECURE_TLS !== ""
        ? parseApiOn(process.env.TOKENSTORM_API_INSECURE_TLS)
        : undefined

    let disposed = false
    let loadId = 0
    let lastSessionId = ""
    let refreshScheduled = false

    refreshPricingFromWeb()

    const [collapsed, setCollapsed] = createSignal(false)
    const [apiUrl, setApiUrl] = createSignal(configApiUrl ?? envApiUrl)
    const [apiEnabled, setApiEnabled] = createSignal((configApiOn ?? envApiOn) === true)
    const [apiInsecureTls, setApiInsecureTls] = createSignal(
      (configApiInsecure ?? envApiInsecure) === true,
    )
    const [labels, setLabels] = createSignal<string[]>(configLabels ?? [])

    // Fallback for when options do not arrive through context.options: read
    // the merged config documents from the server and find this plugin's own
    // `plugins` entry there. Later documents (project scope) win.
    async function fallbackOptionsFromConfig() {
      try {
        const response = await context.client.config.get({
          location: context.location ?? context.data.location.default(),
        } as any)
        const documents: any[] = Array.isArray(response)
          ? (response as any[])
          : ((response as any)?.data ?? [])
        let match: Record<string, unknown> | undefined
        for (const document of documents) {
          const plugins: Array<string | { package?: string; options?: Record<string, unknown> }> =
            document?.info?.plugins ?? []
          for (const plugin of plugins) {
            if (typeof plugin === "string" || typeof plugin?.package !== "string") continue
            const pkg = plugin.package
            const isMine =
              pkg === id ||
              pkg.endsWith("/" + id) ||
              pkg === "./" ||
              pkg === "." ||
              pkg.startsWith("./")
            if (isMine && plugin.options) match = plugin.options
          }
        }
        if (!match) return
        if (typeof match.apiUrl === "string" && match.apiUrl !== "") {
          setApiUrl((current) => current ?? match!.apiUrl as string)
        }
        const on = parseApiOn(match.apiOn)
        if (on !== undefined && configApiOn === undefined && envApiOn === undefined) {
          setApiEnabled(on)
        }
        const insecure = parseApiOn(match.apiInsecureTls)
        if (
          insecure !== undefined &&
          configApiInsecure === undefined &&
          envApiInsecure === undefined
        ) {
          setApiInsecureTls(insecure)
        }
        if (labels().length === 0 && Array.isArray(match.labels)) {
          setLabels(match.labels.map(String))
        }
      } catch {
        // Best-effort fallback; context.options and env vars still apply.
      }
    }
    fallbackOptionsFromConfig()

    let prevTokens: { input: number; output: number; reasoning: number; cacheRead: number; cacheWrite: number; total: number } | null = null
    let lastSentTotal = -1
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

        const requestInit: RequestInit = {
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
        }
        if (apiInsecureTls()) {
          // Bun-specific fetch option: accept expired/self-signed certs.
          Object.assign(requestInit, { tls: { rejectUnauthorized: false } })
        }

        await fetch(apiUrl()!, requestInit)

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

    function reset() {
      prevTokens = null
      resetBaseline = null
      lastSentTotal = -1
      setLabels([])
      if (lastSessionId) {
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
    }

    async function load(sessionId: string) {
      if (disposed || !sessionId) return
      const myLoadId = ++loadId

      for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        try {
          // The local store is only a cache: refresh it from the server
          // first, or session.get() can return undefined or stale tokens.
          await context.data.session.sync(sessionId)
          if (disposed || myLoadId !== loadId) return

          const session = context.data.session.get(sessionId)
          if (!session) throw new Error(`Session ${sessionId} not found`)

          const tokens = session.tokens
          const time = session.time
          const model = session.model
          let duration = 0
          if (time?.created && time?.updated && time.updated > time.created) {
            duration = time.updated - time.created
          }

          let input = tokens?.input ?? 0
          let output = tokens?.output ?? 0
          let reasoning = tokens?.reasoning ?? 0
          let cacheRead = tokens?.cache?.read ?? 0
          let cacheWrite = tokens?.cache?.write ?? 0
          if (resetBaseline) {
            input = Math.max(0, input - resetBaseline.input)
            output = Math.max(0, output - resetBaseline.output)
            reasoning = Math.max(0, reasoning - resetBaseline.reasoning)
            cacheRead = Math.max(0, cacheRead - resetBaseline.cacheRead)
            cacheWrite = Math.max(0, cacheWrite - resetBaseline.cacheWrite)
          }
          const total = input + output + reasoning
          const s: TokenState = {
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
          }
          setState(s)
          sendToApi(s)
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

    // Coalesce bursts of session events into a single reload.
    function scheduleRefresh() {
      if (disposed || refreshScheduled) return
      refreshScheduled = true
      setTimeout(() => {
        refreshScheduled = false
        if (!disposed && lastSessionId) load(lastSessionId)
      }, 500)
    }

    context.keymap.layer(() => ({
      mode: "global",
      priority: 10,
      commands: [
        {
          id: "tokenstorm.reset",
          title: "TokenStorm: Reset",
          group: "TokenStorm",
          run: () => reset(),
        },
        {
          id: "tokenstorm.toggleApi",
          title: "TokenStorm: Toggle API",
          group: "TokenStorm",
          run: () => setApiEnabled((v) => !v),
        },
        {
          id: "tokenstorm.toggleInsecureTls",
          title: `TokenStorm: Toggle Insecure TLS${apiInsecureTls() ? " (on)" : ""}`,
          group: "TokenStorm",
          run: () => setApiInsecureTls((v) => !v),
        },
        {
          id: "tokenstorm.setLabels",
          title: `TokenStorm: Labels${labels().length ? ` (${labels().join(", ")})` : " (not set)"}`,
          group: "TokenStorm",
          run: async () => {
            const current = labels()
            const result = await context.ui.dialog.prompt({
              title: "TokenStorm Labels",
              placeholder: "e.g. experiment-42 (comma-separated)",
              value: current.join(", "),
            })
            if (result !== undefined) {
              const newLabels = result.split(",").map((s) => s.trim()).filter(Boolean)
              setLabels(newLabels)
            }
          },
        },
      ],
    }))

    // Refresh on the events that carry token-usage changes in the 2.* event
    // stream (`session.updated` no longer exists).
    const unsubs = [
      context.data.on("session.usage.updated", (e) => {
        if (e.data?.sessionID === lastSessionId) scheduleRefresh()
      }),
      context.data.on("session.execution.succeeded", (e) => {
        if (e.data?.sessionID === lastSessionId) scheduleRefresh()
      }),
      context.data.on("session.execution.failed", (e) => {
        if (e.data?.sessionID === lastSessionId) scheduleRefresh()
      }),
      context.data.on("session.execution.interrupted", (e) => {
        if (e.data?.sessionID === lastSessionId) scheduleRefresh()
      }),
      context.data.on("session.created", (e) => {
        const sid = e.data?.sessionID
        if (sid && !lastSessionId) {
          lastSessionId = sid
          load(sid)
        }
      }),
    ]

    const interval = setInterval(() => {
      if (lastSessionId) load(lastSessionId)
    }, REFRESH_MS)

    onCleanup(() => {
      disposed = true
      clearInterval(interval)
      for (const unsub of unsubs) unsub()
    })

    context.ui.slot({
      append: "sidebar.content",
      render: (props) => {
        // The slot input carries the session the sidebar is showing. It is
        // reactive, so switching sessions re-targets the counters.
        createEffect(() => {
          const sid = props.sessionID
          if (!sid) return
          if (sid !== lastSessionId) {
            lastSessionId = sid
            resetBaseline = null
            prevTokens = null
            lastSentTotal = -1
            setState({
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
          }
          load(sid)
        })

        const c = collapsed
        return (
          <box gap={0}>
            <text
              fg={context.theme.text.base}
              onMouseDown={() => setCollapsed(!c())}
            >
              {c() ? "▶" : "▼"} <b>TokenStorm</b>
            </text>

            <Show when={!c()}>
              <Show when={state().status === "loading"}>
                <text fg={context.theme.text.muted}>Loading…</text>
              </Show>

              <Show when={state().status === "error"}>
                <text fg={context.theme.text.error}>
                  {state().error || "Unknown error"}
                </text>
              </Show>

              <Show when={state().status === "ready"}>
                <box gap={0}>
                  <text fg={context.theme.text.muted}>
                    Input     {formatCount(state().input)} tok
                  </text>
                  <text fg={context.theme.text.muted}>
                    Output    {formatCount(state().output)} tok
                  </text>
                  <text fg={context.theme.text.muted}>
                    Reasoning {formatCount(state().reasoning)} tok
                  </text>
                  <text fg={context.theme.text.muted}>
                    Cache R   {formatCount(state().cacheRead)} tok
                  </text>
                  <text fg={context.theme.text.muted}>
                    Cache W   {formatCount(state().cacheWrite)} tok
                  </text>
                  <box flexDirection="row">
                    <text fg={context.theme.text.base}>
                      Total     {formatCount(state().total)} tok
                    </text>
                    <text fg={context.theme.text.muted}> · </text>
                    <box onMouseDown={() => reset()}>
                      <text fg={context.theme.text.muted}>
                        ↺ Reset
                      </text>
                    </box>
                  </box>
                  <text fg={context.theme.text.muted}>Cost Estimation</text>
                  <text fg={context.theme.text.muted}>
                    min ({CHEAPEST[0]}) {formatCost(
                      (state().input / 1_000_000) * CHEAPEST[1].input +
                      ((state().output + state().reasoning) / 1_000_000) * CHEAPEST[1].output,
                    )}
                  </text>
                  <text fg={context.theme.text.muted}>
                    max ({EXPENSIVE[0]}) {formatCost(
                      (state().input / 1_000_000) * EXPENSIVE[1].input +
                      ((state().output + state().reasoning) / 1_000_000) * EXPENSIVE[1].output,
                    )}
                  </text>
                </box>
              </Show>

              <box flexDirection="row" onMouseDown={(e: any) => { e?.stopPropagation?.(); setApiEnabled((v) => !v); }}>
                <text fg={context.theme.text.muted}>
                  {apiEnabled()
                    ? `↗ API: On${apiUrl() ? "" : " (no URL)"}${
                        apiInsecureTls() ? " ·insecure-tls" : ""
                      }`
                    : "API: Off"}
                </text>
              </box>

              <Show when={labels().length > 0}>
                <box flexDirection="row">
                  {labels().map((l) => (
                    <text fg={context.theme.text.muted}> · {l}</text>
                  ))}
                </box>
              </Show>
            </Show>
          </box>
        )
      },
    })
  },
})

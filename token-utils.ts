export interface TokenSnapshot {
  input: number
  output: number
  reasoning: number
  cacheRead: number
  cacheWrite: number
  total: number
}

export interface TokenState {
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

/** Total is input + output + reasoning (cache read/write excluded). */
export function computeTotal(input: number, output: number, reasoning: number): number {
  return input + output + reasoning
}

/** Tokens per second from total and session duration in ms. */
export function computeTokPerSec(total: number, durationMs: number): number {
  return durationMs > 0 ? total / (durationMs / 1000) : 0
}

/** Subtract a baseline from raw token values, floor at 0. */
export function applyBaseline(
  tokens: { input: number; output: number; reasoning: number; cacheRead: number; cacheWrite: number },
  baseline: TokenSnapshot,
): { input: number; output: number; reasoning: number; cacheRead: number; cacheWrite: number } {
  return {
    input: Math.max(0, tokens.input - baseline.input),
    output: Math.max(0, tokens.output - baseline.output),
    reasoning: Math.max(0, tokens.reasoning - baseline.reasoning),
    cacheRead: Math.max(0, tokens.cacheRead - baseline.cacheRead),
    cacheWrite: Math.max(0, tokens.cacheWrite - baseline.cacheWrite),
  }
}

/** Delta between current token totals and a previous snapshot. */
export function computeDelta(
  current: TokenSnapshot,
  previous: TokenSnapshot,
): TokenSnapshot {
  return {
    input: current.input - previous.input,
    output: current.output - previous.output,
    reasoning: current.reasoning - previous.reasoning,
    cacheRead: current.cacheRead - previous.cacheRead,
    cacheWrite: current.cacheWrite - previous.cacheWrite,
    total: current.total - previous.total,
  }
}

/** Create a zeroed TokenState (status defaults to "ready"). */
export function zeroTokenState(): TokenState {
  return {
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
  }
}

/** Build a TokenSnapshot from session token data (including nested cache). */
export function toSnapshot(tokens: {
  input?: number | null
  output?: number | null
  reasoning?: number | null
  cache?: { read?: number | null; write?: number | null } | null
}): TokenSnapshot {
  const input = tokens.input ?? 0
  const output = tokens.output ?? 0
  const reasoning = tokens.reasoning ?? 0
  return {
    input,
    output,
    reasoning,
    cacheRead: tokens.cache?.read ?? 0,
    cacheWrite: tokens.cache?.write ?? 0,
    total: computeTotal(input, output, reasoning),
  }
}

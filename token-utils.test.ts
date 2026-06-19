import { describe, expect, test } from "vitest"
import {
  applyBaseline,
  computeDelta,
  computeTokPerSec,
  computeTotal,
  toSnapshot,
  zeroTokenState,
} from "./token-utils"

// -------------------------------------------------------------------------
// computeTotal
// -------------------------------------------------------------------------
describe("computeTotal", () => {
  test("sums input + output + reasoning", () => {
    expect(computeTotal(100, 50, 10)).toBe(160)
  })

  test("returns 0 when all are zero", () => {
    expect(computeTotal(0, 0, 0)).toBe(0)
  })

  test("handles large numbers", () => {
    expect(computeTotal(1_000_000, 2_000_000, 500_000)).toBe(3_500_000)
  })

  test("handles only one non-zero value", () => {
    expect(computeTotal(0, 42, 0)).toBe(42)
  })

  test("does not include cache values", () => {
    const total = computeTotal(100, 50, 10)
    expect(total).toBe(160)
    // cacheRead=999, cacheWrite=999 — not included
  })
})

// -------------------------------------------------------------------------
// computeTokPerSec
// -------------------------------------------------------------------------
describe("computeTokPerSec", () => {
  test("computes tokens per second from duration in ms", () => {
    expect(computeTokPerSec(100, 10_000)).toBe(10) // 100 / 10
  })

  test("returns 0 when duration is 0", () => {
    expect(computeTokPerSec(100, 0)).toBe(0)
  })

  test("returns 0 when total is 0 regardless of duration", () => {
    expect(computeTokPerSec(0, 10_000)).toBe(0)
  })

  test("handles sub-second durations", () => {
    expect(computeTokPerSec(50, 500)).toBe(100) // 50 / 0.5
  })

  test("handles long durations", () => {
    expect(computeTokPerSec(300_000, 3_600_000)).toBeCloseTo(83.33, 1) // 300K / 3600s
  })
})

// -------------------------------------------------------------------------
// applyBaseline
// -------------------------------------------------------------------------
describe("applyBaseline", () => {
  const baseline = { input: 100, output: 50, reasoning: 10, cacheRead: 20, cacheWrite: 5, total: 160 }

  test("subtracts baseline from raw values", () => {
    const raw = { input: 200, output: 100, reasoning: 20, cacheRead: 40, cacheWrite: 10 }
    expect(applyBaseline(raw, baseline)).toEqual({
      input: 100,
      output: 50,
      reasoning: 10,
      cacheRead: 20,
      cacheWrite: 5,
    })
  })

  test("clamps at 0 when raw is less than baseline", () => {
    const raw = { input: 50, output: 20, reasoning: 5, cacheRead: 10, cacheWrite: 2 }
    expect(applyBaseline(raw, baseline)).toEqual({
      input: 0,
      output: 0,
      reasoning: 0,
      cacheRead: 0,
      cacheWrite: 0,
    })
  })

  test("returns zeros when raw equals baseline", () => {
    const raw = { input: 100, output: 50, reasoning: 10, cacheRead: 20, cacheWrite: 5 }
    expect(applyBaseline(raw, baseline)).toEqual({
      input: 0,
      output: 0,
      reasoning: 0,
      cacheRead: 0,
      cacheWrite: 0,
    })
  })

  test("passes through when baseline is all zeros", () => {
    const zero = { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
    const raw = { input: 100, output: 50, reasoning: 10, cacheRead: 20, cacheWrite: 5 }
    expect(applyBaseline(raw, zero)).toEqual(raw)
  })

  test("handles partial baseline (some zeros)", () => {
    const partial = { input: 100, output: 0, reasoning: 0, cacheRead: 20, cacheWrite: 0, total: 100 }
    const raw = { input: 100, output: 50, reasoning: 10, cacheRead: 20, cacheWrite: 5 }
    expect(applyBaseline(raw, partial)).toEqual({
      input: 0,
      output: 50,
      reasoning: 10,
      cacheRead: 0,
      cacheWrite: 5,
    })
  })
})

// -------------------------------------------------------------------------
// computeDelta
// -------------------------------------------------------------------------
describe("computeDelta", () => {
  test("computes positive delta from increase", () => {
    const prev = { input: 100, output: 50, reasoning: 10, cacheRead: 20, cacheWrite: 5, total: 160 }
    const curr = { input: 200, output: 100, reasoning: 20, cacheRead: 40, cacheWrite: 10, total: 320 }
    expect(computeDelta(curr, prev)).toEqual({
      input: 100,
      output: 50,
      reasoning: 10,
      cacheRead: 20,
      cacheWrite: 5,
      total: 160,
    })
  })

  test("returns zeros when no change", () => {
    const val = { input: 100, output: 50, reasoning: 10, cacheRead: 20, cacheWrite: 5, total: 160 }
    expect(computeDelta(val, val)).toEqual({
      input: 0,
      output: 0,
      reasoning: 0,
      cacheRead: 0,
      cacheWrite: 0,
      total: 0,
    })
  })

  test("can produce negative deltas", () => {
    const prev = { input: 200, output: 100, reasoning: 20, cacheRead: 40, cacheWrite: 10, total: 320 }
    const curr = { input: 100, output: 50, reasoning: 10, cacheRead: 20, cacheWrite: 5, total: 160 }
    expect(computeDelta(curr, prev)).toEqual({
      input: -100,
      output: -50,
      reasoning: -10,
      cacheRead: -20,
      cacheWrite: -5,
      total: -160,
    })
  })
})

// -------------------------------------------------------------------------
// zeroTokenState
// -------------------------------------------------------------------------
describe("zeroTokenState", () => {
  test("returns every numeric field as 0", () => {
    const z = zeroTokenState()
    expect(z.input).toBe(0)
    expect(z.output).toBe(0)
    expect(z.reasoning).toBe(0)
    expect(z.cacheRead).toBe(0)
    expect(z.cacheWrite).toBe(0)
    expect(z.total).toBe(0)
    expect(z.duration).toBe(0)
    expect(z.tokPerSec).toBe(0)
  })

  test("status defaults to ready", () => {
    expect(zeroTokenState().status).toBe("ready")
  })

  test("modelId and providerId are undefined", () => {
    const z = zeroTokenState()
    expect(z.modelId).toBeUndefined()
    expect(z.providerId).toBeUndefined()
  })
})

// -------------------------------------------------------------------------
// toSnapshot
// -------------------------------------------------------------------------
describe("toSnapshot", () => {
  test("extracts values from session tokens", () => {
    const tokens = { input: 100, output: 50, reasoning: 10, cache: { read: 20, write: 5 } }
    expect(toSnapshot(tokens)).toEqual({
      input: 100,
      output: 50,
      reasoning: 10,
      cacheRead: 20,
      cacheWrite: 5,
      total: 160,
    })
  })

  test("handles missing cache", () => {
    const tokens = { input: 100, output: 50, reasoning: 10 }
    expect(toSnapshot(tokens)).toEqual({
      input: 100,
      output: 50,
      reasoning: 10,
      cacheRead: 0,
      cacheWrite: 0,
      total: 160,
    })
  })

  test("coerces null/undefined values to 0", () => {
    const tokens = { input: null, output: undefined, reasoning: undefined, cache: null }
    expect(toSnapshot(tokens)).toEqual({
      input: 0,
      output: 0,
      reasoning: 0,
      cacheRead: 0,
      cacheWrite: 0,
      total: 0,
    })
  })

  test("handles empty object", () => {
    expect(toSnapshot({})).toEqual({
      input: 0,
      output: 0,
      reasoning: 0,
      cacheRead: 0,
      cacheWrite: 0,
      total: 0,
    })
  })
})

// -------------------------------------------------------------------------
// Integration: reset flow scenario
// -------------------------------------------------------------------------
describe("reset flow integration", () => {
  const sessionTokens = { input: 100, output: 50, reasoning: 10, cache: { read: 20, write: 5 } }

  test("toSnapshot + zeroTokenState matches expected reset behavior", () => {
    // Simulate reset: capture snapshot, then zero display
    const baseline = toSnapshot(sessionTokens)
    expect(baseline).toEqual({ input: 100, output: 50, reasoning: 10, cacheRead: 20, cacheWrite: 5, total: 160 })

    const display = zeroTokenState()
    expect(display.total).toBe(0)

    // After reset, fresh tokens should be baseline-subtracted
    const subsequentTokens = { input: 105, output: 55, reasoning: 12, cache: { read: 22, write: 7 } }
    const raw = {
      input: subsequentTokens.input ?? 0,
      output: subsequentTokens.output ?? 0,
      reasoning: subsequentTokens.reasoning ?? 0,
      cacheRead: subsequentTokens.cache?.read ?? 0,
      cacheWrite: subsequentTokens.cache?.write ?? 0,
    }
    const adjusted = applyBaseline(raw, baseline)
    expect(adjusted).toEqual({ input: 5, output: 5, reasoning: 2, cacheRead: 2, cacheWrite: 2 })
    expect(computeTotal(adjusted.input, adjusted.output, adjusted.reasoning)).toBe(12)
  })

  test("prevTokens zeroed after reset prevents negative deltas", () => {
    // After reset: prevTokens = { all zeros }
    const prevTokens = { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, total: 0 }

    // Next load: no new tokens, baseline-subtracted = all zeros
    const current = { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
    const delta = computeDelta(current, prevTokens)
    expect(delta).toEqual({ input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, total: 0 })

    // New tokens arrive: delta computed from zero prevTokens
    const updated = { input: 10, output: 5, reasoning: 2, cacheRead: 3, cacheWrite: 1, total: 17 }
    const delta2 = computeDelta(updated, prevTokens)
    expect(delta2).toEqual({ input: 10, output: 5, reasoning: 2, cacheRead: 3, cacheWrite: 1, total: 17 })
  })

  test("toSnapshot total matches computeTotal", () => {
    const snapshot = toSnapshot(sessionTokens)
    const computed = computeTotal(sessionTokens.input ?? 0, sessionTokens.output ?? 0, sessionTokens.reasoning ?? 0)
    expect(snapshot.total).toBe(computed)
  })
})

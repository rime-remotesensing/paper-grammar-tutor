/**
 * Lightweight, dev/debug-only latency instrumentation for the analysis pipeline. Not a
 * tracing framework -- just enough to answer "where did the time go for this sentence"
 * (Stanza syntax vs. grammar-analysis LLM call vs. reading-guide LLM call, etc.) without
 * threading timing state through every function signature.
 *
 * `console.debug` only (never `console.log`), and the recorded list is capped so a long
 * session can't leak memory. Safe to call from both the Vite app and a plain Node script.
 */
export interface StageTiming {
  label: string
  ms: number
  at: number
}

const MAX_RECORDED = 500
const timings: StageTiming[] = []

export function recordStageTiming(label: string, ms: number): void {
  timings.push({ label, ms, at: Date.now() })
  if (timings.length > MAX_RECORDED) timings.shift()
  // eslint-disable-next-line no-console -- intentional dev-facing latency log, not app output.
  console.debug(`[timing] ${label}: ${Math.round(ms)}ms`)
}

export function getRecordedStageTimings(): readonly StageTiming[] {
  return timings
}

export function resetStageTimings(): void {
  timings.length = 0
}

/**
 * Lightweight, dev/debug-only latency instrumentation for the analysis pipeline. Not a
 * tracing framework -- just enough to answer "where did the time go for this sentence"
 * (Stanza syntax vs. grammar-analysis LLM call vs. reading-guide LLM call, etc.) without
 * threading timing state through every function signature.
 *
 * Recording itself (the arrays + get/reset functions) always runs, in every environment --
 * this is what benchmark/investigation scripts (run via plain `node script.ts`, outside
 * Vite) read. Only the `console.debug` calls are gated behind `isDevInstrumentation` (see
 * below), matching the app's existing dev-only pattern (PdfViewer.tsx's `TRACE_ENABLED =
 * import.meta.env.DEV`) so a production build never prints these to the browser console.
 * `console.debug` only (never `console.log`), and the recorded list is capped so a long
 * session can't leak memory.
 */

/**
 * True only in Vite's dev server (or a dev-mode test run); statically false in a production
 * build (Vite always defines `import.meta.env.DEV`), so the `if` guards below become dead
 * code a minifier can drop. `typeof import.meta.env !== 'undefined'` guards the case where
 * this module runs completely outside Vite (a plain `node script.ts` investigation/benchmark
 * script, as used throughout this session) -- there `import.meta.env` is simply absent, not
 * an error, and instrumentation recording still works; only the console logging is skipped.
 */
const isDevInstrumentation = typeof import.meta.env !== 'undefined' && import.meta.env.DEV === true

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
  if (isDevInstrumentation) {
    // eslint-disable-next-line no-console -- intentional dev-facing latency log, not app output.
    console.debug(`[timing] ${label}: ${Math.round(ms)}ms`)
  }
}

export function getRecordedStageTimings(): readonly StageTiming[] {
  return timings
}

export function resetStageTimings(): void {
  timings.length = 0
}

/**
 * One recorded Ollama /api/chat request, at the request/repair-attempt granularity (not
 * merged across repair attempts of the same analyzer). `label` identifies which analyzer and
 * attempt this is (e.g. "grammar-analysis.initial", "grammar-analysis.repair.1"). Token/
 * duration fields are null exactly when Ollama's response didn't include them -- never
 * estimated or fabricated.
 */
export interface OllamaCallTiming {
  label: string
  model: string
  wallMs: number
  promptTokens: number | null
  outputTokens: number | null
  totalDurationMs: number | null
  loadDurationMs: number | null
  promptEvalDurationMs: number | null
  evalDurationMs: number | null
  at: number
}

const MAX_RECORDED_OLLAMA_CALLS = 500
const ollamaCalls: OllamaCallTiming[] = []

export function recordOllamaCall(entry: Omit<OllamaCallTiming, 'at'>): void {
  const recorded: OllamaCallTiming = { ...entry, at: Date.now() }
  ollamaCalls.push(recorded)
  if (ollamaCalls.length > MAX_RECORDED_OLLAMA_CALLS) ollamaCalls.shift()
  if (isDevInstrumentation) {
    const tokenPart =
      recorded.promptTokens !== null && recorded.outputTokens !== null
        ? `in=${recorded.promptTokens}tok out=${recorded.outputTokens}tok`
        : 'tokens=unavailable'
    const breakdownPart =
      recorded.loadDurationMs !== null && recorded.promptEvalDurationMs !== null && recorded.evalDurationMs !== null
        ? ` (load=${Math.round(recorded.loadDurationMs)}ms promptEval=${Math.round(recorded.promptEvalDurationMs)}ms gen=${Math.round(recorded.evalDurationMs)}ms)`
        : ''
    // eslint-disable-next-line no-console -- intentional dev-facing latency log, not app output.
    console.debug(`[ollama-call] ${recorded.label} [${recorded.model}]: ${Math.round(recorded.wallMs)}ms wall, ${tokenPart}${breakdownPart}`)
  }
}

export function getRecordedOllamaCalls(): readonly OllamaCallTiming[] {
  return ollamaCalls
}

export function resetOllamaCallTimings(): void {
  ollamaCalls.length = 0
}

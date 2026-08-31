export interface ModelInfo {
  name: string
  sizeBytes: number | null
}

export interface HealthStatus {
  ok: boolean
  message: string
}

export interface GenerateStructuredRequest {
  model: string
  systemPrompt: string
  userPrompt: string
  /** JSON Schema describing the required output shape, passed to the provider's structured-output mode. */
  jsonSchema: Record<string, unknown>
  temperature: number
  /** Investigation-only instrumentation label identifying which analyzer/repair-attempt this
   * request is (e.g. "grammar-analysis.initial", "grammar-analysis.repair.1"). Purely
   * diagnostic -- providers may ignore it; it never affects the request sent to the LLM. */
  callLabel?: string
}

export interface GenerateStructuredResult {
  rawText: string
  elapsedMs: number
  /**
   * Ollama /api/chat-reported metrics, only when the provider actually returned them.
   * Explicitly null (never fabricated/estimated) when unavailable -- see OllamaProvider.ts.
   * Durations are converted from Ollama's nanoseconds to milliseconds.
   */
  promptTokens?: number | null
  outputTokens?: number | null
  totalDurationMs?: number | null
  loadDurationMs?: number | null
  promptEvalDurationMs?: number | null
  evalDurationMs?: number | null
}

/**
 * Boundary between the app and a specific LLM backend. GrammarAnalyzer and the UI
 * depend only on this interface, never on Ollama-specific request/response shapes,
 * so a future provider can be added without touching analysis logic or components.
 */
export interface LLMProvider {
  listModels(): Promise<ModelInfo[]>
  healthCheck(): Promise<HealthStatus>
  generateStructured(request: GenerateStructuredRequest): Promise<GenerateStructuredResult>
}

export class LLMProviderError extends Error {
  readonly cause?: unknown

  constructor(message: string, cause?: unknown) {
    super(message)
    this.cause = cause
    this.name = 'LLMProviderError'
  }
}

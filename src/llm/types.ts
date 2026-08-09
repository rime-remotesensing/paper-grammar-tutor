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
}

export interface GenerateStructuredResult {
  rawText: string
  elapsedMs: number
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

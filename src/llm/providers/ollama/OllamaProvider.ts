import {
  GENERATE_TIMEOUT_MS,
  HEALTH_CHECK_TIMEOUT_MS,
  LIST_MODELS_TIMEOUT_MS,
} from '../../../config/settings.ts'
import type {
  GenerateStructuredRequest,
  GenerateStructuredResult,
  HealthStatus,
  LLMProvider,
  ModelInfo,
} from '../../types.ts'
import { LLMProviderError } from '../../types.ts'

interface OllamaTagsResponse {
  models?: Array<{ name?: string; size?: number }>
}

interface OllamaChatResponse {
  message?: { content?: string }
}

/**
 * Talks to a local Ollama server. This is the only file that knows about
 * Ollama's REST shape (`/api/tags`, `/api/chat`); everything else in the app
 * depends on the LLMProvider interface instead.
 */
export class OllamaProvider implements LLMProvider {
  private readonly baseUrl: string

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl
  }

  async healthCheck(): Promise<HealthStatus> {
    try {
      const res = await fetchWithTimeout(`${this.baseUrl}/api/tags`, {}, HEALTH_CHECK_TIMEOUT_MS)
      if (!res.ok) {
        return { ok: false, message: `Ollama responded with HTTP ${res.status}` }
      }
      return { ok: true, message: 'connected' }
    } catch (err) {
      return { ok: false, message: describeNetworkError(err) }
    }
  }

  async listModels(): Promise<ModelInfo[]> {
    let res: Response
    try {
      res = await fetchWithTimeout(`${this.baseUrl}/api/tags`, {}, LIST_MODELS_TIMEOUT_MS)
    } catch (err) {
      throw new LLMProviderError(describeNetworkError(err), err)
    }
    if (!res.ok) {
      throw new LLMProviderError(`Ollama responded with HTTP ${res.status} while listing models`)
    }
    const data = (await res.json()) as OllamaTagsResponse
    return (data.models ?? [])
      .filter((m): m is { name: string; size?: number } => typeof m.name === 'string')
      .map((m) => ({ name: m.name, sizeBytes: typeof m.size === 'number' ? m.size : null }))
  }

  async generateStructured(
    request: GenerateStructuredRequest,
  ): Promise<GenerateStructuredResult> {
    const startedAt = performance.now()
    let res: Response
    try {
      res = await fetchWithTimeout(
        `${this.baseUrl}/api/chat`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: request.model,
            stream: false,
            messages: [
              { role: 'system', content: request.systemPrompt },
              { role: 'user', content: request.userPrompt },
            ],
            format: request.jsonSchema,
            options: { temperature: request.temperature },
          }),
        },
        GENERATE_TIMEOUT_MS,
      )
    } catch (err) {
      throw new LLMProviderError(describeNetworkError(err), err)
    }

    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new LLMProviderError(`Ollama responded with HTTP ${res.status}: ${body.slice(0, 300)}`)
    }

    const data = (await res.json()) as OllamaChatResponse
    const rawText = data.message?.content
    if (typeof rawText !== 'string') {
      throw new LLMProviderError('Ollama response did not contain message.content')
    }
    return { rawText, elapsedMs: performance.now() - startedAt }
  }
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

function describeNetworkError(err: unknown): string {
  if (err instanceof DOMException && err.name === 'AbortError') {
    return 'Ollama did not respond in time (timeout)'
  }
  if (err instanceof Error) {
    return `Could not reach Ollama: ${err.message}`
  }
  return 'Could not reach Ollama'
}

import {
  GENERATE_TIMEOUT_MS,
  HEALTH_CHECK_TIMEOUT_MS,
  LIST_MODELS_TIMEOUT_MS,
  OLLAMA_KEEP_ALIVE,
} from '../../../config/settings.ts'
import { recordOllamaCall } from '../../timing.ts'
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

/**
 * Only `message.content` was read here before; the rest of these fields (confirmed present
 * in this Ollama version's actual /api/chat, non-streaming response -- see
 * docs/design-notes.md investigation notes) are Ollama-reported call metrics, added purely
 * for investigation-phase instrumentation (recordOllamaCall). Durations are nanoseconds as
 * Ollama returns them; all fields are optional since a future Ollama response shape or a
 * different provider might not include them -- never assumed present.
 */
interface OllamaChatResponse {
  message?: { content?: string }
  prompt_eval_count?: number
  eval_count?: number
  total_duration?: number
  load_duration?: number
  prompt_eval_duration?: number
  eval_duration?: number
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
            keep_alive: OLLAMA_KEEP_ALIVE,
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
    const elapsedMs = performance.now() - startedAt
    const nsToMs = (ns: number | undefined): number | null => (typeof ns === 'number' ? ns / 1_000_000 : null)
    const promptTokens = typeof data.prompt_eval_count === 'number' ? data.prompt_eval_count : null
    const outputTokens = typeof data.eval_count === 'number' ? data.eval_count : null
    const totalDurationMs = nsToMs(data.total_duration)
    const loadDurationMs = nsToMs(data.load_duration)
    const promptEvalDurationMs = nsToMs(data.prompt_eval_duration)
    const evalDurationMs = nsToMs(data.eval_duration)

    recordOllamaCall({
      label: request.callLabel ?? 'unlabeled',
      model: request.model,
      wallMs: elapsedMs,
      promptTokens,
      outputTokens,
      totalDurationMs,
      loadDurationMs,
      promptEvalDurationMs,
      evalDurationMs,
    })

    return {
      rawText,
      elapsedMs,
      promptTokens,
      outputTokens,
      totalDurationMs,
      loadDurationMs,
      promptEvalDurationMs,
      evalDurationMs,
    }
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

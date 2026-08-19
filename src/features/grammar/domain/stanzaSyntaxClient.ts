import { STANZA_SYNTAX_ANALYZE_TIMEOUT_MS, STANZA_SYNTAX_SERVICE_URL } from '../../../config/settings.ts'
import type { StanzaToken } from './stanzaSyntaxAuthority.ts'

/**
 * Prototype 2.6G1 -- HTTP client for the local Stanza syntax authority service
 * (services/stanza_syntax). Local-only, no cloud fallback. On any failure this
 * throws StanzaSyntaxUnavailableError rather than returning something that
 * looks like a successful parse, so a caller's failure-policy decision (see
 * analyzeSyntaxAuthority.ts) is made in exactly one place, not guessed at here.
 */

export interface StanzaAnalyzeResult {
  tokens: StanzaToken[]
}

export class StanzaSyntaxUnavailableError extends Error {
  readonly cause?: unknown
  constructor(message: string, cause?: unknown) {
    super(message)
    this.name = 'StanzaSyntaxUnavailableError'
    this.cause = cause
  }
}

export async function fetchStanzaAnalysis(text: string, baseUrl: string = STANZA_SYNTAX_SERVICE_URL): Promise<StanzaAnalyzeResult> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), STANZA_SYNTAX_ANALYZE_TIMEOUT_MS)
  try {
    const response = await fetch(`${baseUrl}/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
      signal: controller.signal,
    })
    if (!response.ok) {
      throw new StanzaSyntaxUnavailableError(`Stanza syntax service returned HTTP ${response.status}`)
    }
    const body: unknown = await response.json()
    if (!body || typeof body !== 'object' || !Array.isArray((body as { tokens?: unknown }).tokens)) {
      throw new StanzaSyntaxUnavailableError('Stanza syntax service returned a malformed response')
    }
    return { tokens: (body as { tokens: StanzaToken[] }).tokens }
  } catch (error) {
    if (error instanceof StanzaSyntaxUnavailableError) throw error
    throw new StanzaSyntaxUnavailableError('Stanza syntax service is unreachable', error)
  } finally {
    clearTimeout(timeout)
  }
}

export interface StanzaHealth {
  status: string
  modelReady: boolean
  stanzaVersion?: string
  package?: string
}

export async function fetchStanzaHealth(baseUrl: string = STANZA_SYNTAX_SERVICE_URL): Promise<StanzaHealth | null> {
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 3000)
    const response = await fetch(`${baseUrl}/health`, { signal: controller.signal })
    clearTimeout(timeout)
    if (!response.ok) return null
    return (await response.json()) as StanzaHealth
  } catch {
    return null
  }
}

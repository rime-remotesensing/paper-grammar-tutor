import { beforeEach, describe, expect, it } from 'vitest'
import { getPredicateStructure, resetPredicateStructureCache } from '../../src/features/grammar/domain/predicateStructureService'
import type { SentenceCore } from '../../src/features/grammar/schemas/grammarAnalysis.schema'
import type {
  GenerateStructuredRequest,
  GenerateStructuredResult,
  HealthStatus,
  LLMProvider,
  ModelInfo,
} from '../../src/llm/types'

const SENTENCE = 'The sensor collected data and analyzed the results.'

const VALID_RESPONSE = JSON.stringify({
  subjectModifiers: [],
  predicates: [{ text: 'collected', relation: 'main', dependents: [{ text: 'data', role: 'object', children: [] }] }],
  sentenceModifiers: [],
})

function core(overrides: Partial<SentenceCore> = {}): SentenceCore {
  return {
    subject: { text: 'The sensor', start: 0, end: 10 },
    subjectHead: { text: 'sensor', start: 4, end: 10 },
    verb: { text: 'collected', start: 11, end: 20 },
    indirectObject: null,
    object: null,
    complement: null,
    pattern: 'SVO',
    ...overrides,
  }
}

class CountingProvider implements LLMProvider {
  callCount = 0
  private readonly response: string

  constructor(response: string) {
    this.response = response
  }

  async listModels(): Promise<ModelInfo[]> {
    return []
  }

  async healthCheck(): Promise<HealthStatus> {
    return { ok: true, message: 'ok' }
  }

  async generateStructured(_request: GenerateStructuredRequest): Promise<GenerateStructuredResult> {
    this.callCount += 1
    return { rawText: this.response, elapsedMs: 1 }
  }
}

class FailingProvider implements LLMProvider {
  callCount = 0

  async listModels(): Promise<ModelInfo[]> {
    return []
  }

  async healthCheck(): Promise<HealthStatus> {
    return { ok: true, message: 'ok' }
  }

  async generateStructured(_request: GenerateStructuredRequest): Promise<GenerateStructuredResult> {
    this.callCount += 1
    return { rawText: 'not valid json', elapsedMs: 1 }
  }
}

beforeEach(() => {
  resetPredicateStructureCache()
})

describe('getPredicateStructure — caching (Prototype 2.3C item 26 — independent from ReadingGuide cache)', () => {
  it('calls the LLM only once for repeated requests with the same text/model/sentenceCore', async () => {
    const provider = new CountingProvider(VALID_RESPONSE)
    const params = { provider, model: 'test-model', originalText: SENTENCE, sentenceCore: core(), temperature: 0.1 }

    const first = await getPredicateStructure(params)
    const second = await getPredicateStructure(params)

    expect(first.success).toBe(true)
    expect(second.success).toBe(true)
    expect(provider.callCount).toBe(1)
  })

  it('invalidates the cache when the model changes', async () => {
    const provider = new CountingProvider(VALID_RESPONSE)
    const base = { provider, originalText: SENTENCE, sentenceCore: core(), temperature: 0.1 }

    await getPredicateStructure({ ...base, model: 'model-a' })
    await getPredicateStructure({ ...base, model: 'model-b' })

    expect(provider.callCount).toBe(2)
  })

  it('invalidates the cache when sentenceCore changes (e.g. after forced-core recovery)', async () => {
    const provider = new CountingProvider(VALID_RESPONSE)
    const base = { provider, model: 'test-model', originalText: SENTENCE, temperature: 0.1 }

    await getPredicateStructure({ ...base, sentenceCore: core() })
    await getPredicateStructure({ ...base, sentenceCore: core({ pattern: 'SV', object: null, verb: { text: 'ran', start: 0, end: 3 } }) })

    expect(provider.callCount).toBe(2)
  })

  it('does not reuse the cache across different sentence text', async () => {
    const provider = new CountingProvider(VALID_RESPONSE)
    const base = { provider, model: 'test-model', sentenceCore: core(), temperature: 0.1 }

    await getPredicateStructure({ ...base, originalText: SENTENCE })
    await getPredicateStructure({ ...base, originalText: 'The sensor collected data twice.' })

    expect(provider.callCount).toBe(2)
  })

  it('evicts a failed generation from the cache so a retry actually calls the LLM again', async () => {
    const provider = new FailingProvider()
    const params = { provider, model: 'test-model', originalText: SENTENCE, sentenceCore: core(), temperature: 0.1 }

    const first = await getPredicateStructure(params)
    expect(first.success).toBe(false)
    const callsAfterFirstFailure = provider.callCount

    const second = await getPredicateStructure(params)
    expect(second.success).toBe(false)
    expect(provider.callCount).toBeGreaterThan(callsAfterFirstFailure)
  })

  it('is independent from the ReadingGuide cache (different module-level Map)', async () => {
    // Regression guard for item 26 ("caches分離"): resetting THIS cache must not be the
    // only place either cache is reset, and calling this service must never share a key
    // namespace with readingGuideService's cache. Verified structurally: this module
    // exposes its own resetPredicateStructureCache, distinct from resetReadingGuideCache.
    const provider = new CountingProvider(VALID_RESPONSE)
    const params = { provider, model: 'test-model', originalText: SENTENCE, sentenceCore: core(), temperature: 0.1 }
    await getPredicateStructure(params)
    expect(provider.callCount).toBe(1)
  })
})

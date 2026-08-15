import { beforeEach, describe, expect, it } from 'vitest'
import { getReadingGuide, resetReadingGuideCache } from '../../src/features/grammar/domain/readingGuideService'
import type { SentenceCore } from '../../src/features/grammar/schemas/grammarAnalysis.schema'
import type {
  GenerateStructuredRequest,
  GenerateStructuredResult,
  HealthStatus,
  LLMProvider,
  ModelInfo,
} from '../../src/llm/types'

const SENTENCE = 'Data was recorded every 1 nm in the 0.4 to 0.8 μm region.'

const VALID_RESPONSE = JSON.stringify({
  readingSteps: [
    { text: 'Data', cue: '何について？', explanation: '主語。' },
    { text: 'was recorded', cue: 'どうなった？', explanation: '受動態。' },
  ],
  structureBranches: [],
  connections: [],
  expressions: [],
  readingAdvice: [],
})

function core(overrides: Partial<SentenceCore> = {}): SentenceCore {
  return {
    subject: { text: 'Data', start: 0, end: 4 },
    subjectHead: { text: 'Data', start: 0, end: 4 },
    verb: { text: 'was recorded', start: 5, end: 17 },
    indirectObject: null,
    object: null,
    complement: null,
    pattern: 'SV',
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
  resetReadingGuideCache()
})

describe('getReadingGuide — caching', () => {
  it('calls the LLM only once for repeated requests with the same text/model/sentenceCore', async () => {
    const provider = new CountingProvider(VALID_RESPONSE)
    const params = { provider, model: 'test-model', originalText: SENTENCE, sentenceCore: core(), temperature: 0.1 }

    const first = await getReadingGuide(params)
    const second = await getReadingGuide(params)

    expect(first.success).toBe(true)
    expect(second.success).toBe(true)
    // 2 generateStructured calls total is expected per successful analysis (repair budget
    // is per-call, not per cache-hit) — the key assertion is that the SECOND getReadingGuide
    // call didn't trigger another analysis at all.
    expect(provider.callCount).toBe(1)
  })

  it('invalidates the cache when the model changes', async () => {
    const provider = new CountingProvider(VALID_RESPONSE)
    const base = { provider, originalText: SENTENCE, sentenceCore: core(), temperature: 0.1 }

    await getReadingGuide({ ...base, model: 'model-a' })
    await getReadingGuide({ ...base, model: 'model-b' })

    expect(provider.callCount).toBe(2)
  })

  it('invalidates the cache when sentenceCore changes (e.g. after forced-core recovery)', async () => {
    const provider = new CountingProvider(VALID_RESPONSE)
    const base = { provider, model: 'test-model', originalText: SENTENCE, temperature: 0.1 }

    await getReadingGuide({ ...base, sentenceCore: core() })
    await getReadingGuide({ ...base, sentenceCore: core({ pattern: 'SVO', object: { text: 'x', start: 0, end: 1 } }) })

    expect(provider.callCount).toBe(2)
  })

  it('does not reuse the cache across different sentence text', async () => {
    const provider = new CountingProvider(VALID_RESPONSE)
    const base = { provider, model: 'test-model', sentenceCore: core(), temperature: 0.1 }

    // Both sentences contain "Data"/"was recorded" verbatim so VALID_RESPONSE grounds
    // successfully against either one — isolates the cache-key check from grounding.
    await getReadingGuide({ ...base, originalText: SENTENCE })
    await getReadingGuide({ ...base, originalText: 'Data was recorded twice that day.' })

    expect(provider.callCount).toBe(2)
  })

  it('evicts a failed generation from the cache so a retry actually calls the LLM again', async () => {
    const provider = new FailingProvider()
    const params = { provider, model: 'test-model', originalText: SENTENCE, sentenceCore: core(), temperature: 0.1 }

    const first = await getReadingGuide(params)
    expect(first.success).toBe(false)
    const callsAfterFirstFailure = provider.callCount // 2, due to the one-repair budget

    const second = await getReadingGuide(params)
    expect(second.success).toBe(false)
    expect(provider.callCount).toBeGreaterThan(callsAfterFirstFailure)
  })
})

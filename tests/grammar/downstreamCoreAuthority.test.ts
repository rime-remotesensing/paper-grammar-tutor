import { beforeEach, describe, expect, it } from 'vitest'
import { getPredicateStructure, resetPredicateStructureCache } from '../../src/features/grammar/domain/predicateStructureService'
import { getReadingGuide, resetReadingGuideCache } from '../../src/features/grammar/domain/readingGuideService'
import type { SentenceCore } from '../../src/features/grammar/schemas/grammarAnalysis.schema'
import type {
  GenerateStructuredRequest,
  GenerateStructuredResult,
  HealthStatus,
  LLMProvider,
  ModelInfo,
} from '../../src/llm/types'

// Prototype 2.3I item 40 — downstream core authority contract tests. AnalysisResultPanel
// must pass `effectiveCore` (never rawCore/analysis.sentenceCore) to every downstream
// consumer (item 20). This can't be verified by rendering the component (no React Testing
// Library in this project — see 2.3C's report), so instead this proves the MECHANISM that
// makes passing the right core meaningful: predicateStructureService/readingGuideService
// are sensitive to exactly which sentenceCore object is passed — a raw SVOC core and its
// verified SVO effectiveCore produce DIFFERENT cache keys (and therefore never silently
// reuse a stale SVOC-era structure result under a verified-SVO core, item 22).

const SENTENCE = 'We describe the method, emphasizing its advantages.'

const RAW_SVOC_CORE: SentenceCore = {
  subject: { text: 'We', start: 0, end: 2 },
  subjectHead: { text: 'We', start: 0, end: 2 },
  verb: { text: 'describe', start: 3, end: 11 },
  indirectObject: null,
  object: { text: 'the method', start: 12, end: 22 },
  complement: { text: 'emphasizing its advantages', start: 24, end: 51 },
  pattern: 'SVOC',
}

const EFFECTIVE_SVO_CORE: SentenceCore = {
  ...RAW_SVOC_CORE,
  complement: null,
  pattern: 'SVO',
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

const VALID_STRUCTURE_RESPONSE = JSON.stringify({
  subjectModifiers: [],
  predicates: [{ text: 'describe', relation: 'main', dependents: [{ text: 'the method', role: 'object', children: [] }] }],
  sentenceModifiers: [],
})

const VALID_READING_GUIDE_RESPONSE = JSON.stringify({
  readingSteps: [{ text: 'We', cue: 'x', explanation: 'x' }],
  connections: [],
  expressions: [],
  readingAdvice: [],
})

beforeEach(() => {
  resetPredicateStructureCache()
  resetReadingGuideCache()
})

describe('predicateStructureService — rawCore vs effectiveCore never share a cache entry', () => {
  it('calling with rawCore then effectiveCore triggers TWO separate LLM calls (different cache keys)', async () => {
    const provider = new CountingProvider(VALID_STRUCTURE_RESPONSE)
    await getPredicateStructure({ provider, model: 'test-model', originalText: SENTENCE, sentenceCore: RAW_SVOC_CORE, temperature: 0.1 })
    await getPredicateStructure({ provider, model: 'test-model', originalText: SENTENCE, sentenceCore: EFFECTIVE_SVO_CORE, temperature: 0.1 })
    expect(provider.callCount).toBe(2)
  })

  it('calling with the SAME effectiveCore twice reuses the cache (one call)', async () => {
    const provider = new CountingProvider(VALID_STRUCTURE_RESPONSE)
    await getPredicateStructure({ provider, model: 'test-model', originalText: SENTENCE, sentenceCore: EFFECTIVE_SVO_CORE, temperature: 0.1 })
    await getPredicateStructure({ provider, model: 'test-model', originalText: SENTENCE, sentenceCore: EFFECTIVE_SVO_CORE, temperature: 0.1 })
    expect(provider.callCount).toBe(1)
  })
})

describe('readingGuideService — rawCore vs effectiveCore never share a cache entry', () => {
  it('calling with rawCore then effectiveCore triggers TWO separate LLM calls (different cache keys)', async () => {
    const provider = new CountingProvider(VALID_READING_GUIDE_RESPONSE)
    await getReadingGuide({ provider, model: 'test-model', originalText: SENTENCE, sentenceCore: RAW_SVOC_CORE, temperature: 0.1 })
    await getReadingGuide({ provider, model: 'test-model', originalText: SENTENCE, sentenceCore: EFFECTIVE_SVO_CORE, temperature: 0.1 })
    expect(provider.callCount).toBe(2)
  })
})

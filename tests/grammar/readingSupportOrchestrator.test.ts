import { beforeEach, describe, expect, it } from 'vitest'
import { startReadingSupport } from '../../src/features/grammar/domain/readingSupportOrchestrator'
import { resetReadingGuideCache } from '../../src/features/grammar/domain/readingGuideService'
import { resetPredicateStructureCache } from '../../src/features/grammar/domain/predicateStructureService'
import type { SentenceCore } from '../../src/features/grammar/schemas/grammarAnalysis.schema'
import type {
  GenerateStructuredRequest,
  GenerateStructuredResult,
  HealthStatus,
  LLMProvider,
  ModelInfo,
} from '../../src/llm/types'

const SENTENCE = 'The sensor collected data and analyzed the results.'

function core(): SentenceCore {
  return {
    subject: { text: 'The sensor', start: 0, end: 10 },
    subjectHead: { text: 'sensor', start: 4, end: 10 },
    verb: { text: 'collected', start: 11, end: 20 },
    indirectObject: null,
    object: { text: 'data', start: 21, end: 25 },
    complement: null,
    pattern: 'SVO',
  }
}

const VALID_READING_GUIDE = JSON.stringify({
  readingSteps: [{ text: 'The sensor', cue: 'x', explanation: 'x' }],
  connections: [],
  expressions: [],
  readingAdvice: [],
})

const VALID_STRUCTURE = JSON.stringify({
  subjectModifiers: [],
  predicates: [{ text: 'collected', relation: 'main', dependents: [{ text: 'data', role: 'object', children: [] }] }],
  sentenceModifiers: [],
})

const INVALID_JSON = 'not valid json'

/** Routes by systemPrompt content (ReadingGuide vs PredicateStructure prompts are
 * distinct English text) so a single provider stub can serve both services independently
 * — this is what lets the test observe true call-order/parallelism. */
class RoutingProvider implements LLMProvider {
  callOrder: string[] = []
  readingGuideResponse: string
  structureResponse: string

  constructor(readingGuideResponse: string, structureResponse: string) {
    this.readingGuideResponse = readingGuideResponse
    this.structureResponse = structureResponse
  }

  async listModels(): Promise<ModelInfo[]> {
    return []
  }

  async healthCheck(): Promise<HealthStatus> {
    return { ok: true, message: 'ok' }
  }

  async generateStructured(request: GenerateStructuredRequest): Promise<GenerateStructuredResult> {
    const isStructureCall = request.systemPrompt.includes('ONLY the grammatical structure')
    this.callOrder.push(isStructureCall ? 'structure' : 'readingGuide')
    return { rawText: isStructureCall ? this.structureResponse : this.readingGuideResponse, elapsedMs: 1 }
  }
}

beforeEach(() => {
  resetReadingGuideCache()
  resetPredicateStructureCache()
})

describe('startReadingSupport — Prototype 2.3C item 24 (parallel start)', () => {
  it('starts BOTH services immediately — the structure call is already in flight before readingGuide is awaited', () => {
    const provider = new RoutingProvider(VALID_READING_GUIDE, VALID_STRUCTURE)
    const { readingGuide, structure } = startReadingSupport({
      provider,
      model: 'test-model',
      originalText: SENTENCE,
      sentenceCore: core(),
      temperature: 0.1,
    })
    // Both calls should already have been dispatched synchronously by the time we get
    // here, before either promise has been awaited.
    expect(provider.callOrder).toContain('readingGuide')
    expect(provider.callOrder).toContain('structure')
    // Silence unused-promise lint concerns; outcomes are asserted in the next test.
    void readingGuide
    void structure
  })

  it('resolves both outcomes successfully when both underlying calls succeed', async () => {
    const provider = new RoutingProvider(VALID_READING_GUIDE, VALID_STRUCTURE)
    const { readingGuide, structure } = startReadingSupport({
      provider,
      model: 'test-model',
      originalText: SENTENCE,
      sentenceCore: core(),
      temperature: 0.1,
    })
    const [readingGuideOutcome, structureOutcome] = await Promise.all([readingGuide, structure])
    expect(readingGuideOutcome.success).toBe(true)
    expect(structureOutcome.success).toBe(true)
  })
})

describe('startReadingSupport — failure independence (item 23)', () => {
  it('a failing structure call does not affect a succeeding readingGuide call, and vice versa', async () => {
    const provider = new RoutingProvider(VALID_READING_GUIDE, INVALID_JSON)
    const { readingGuide, structure } = startReadingSupport({
      provider,
      model: 'test-model',
      originalText: SENTENCE,
      sentenceCore: core(),
      temperature: 0.1,
    })
    const [readingGuideOutcome, structureOutcome] = await Promise.all([readingGuide, structure])
    expect(readingGuideOutcome.success).toBe(true)
    expect(structureOutcome.success).toBe(false)
  })

  it('a failing readingGuide call does not affect a succeeding structure call', async () => {
    const provider = new RoutingProvider(INVALID_JSON, VALID_STRUCTURE)
    const { readingGuide, structure } = startReadingSupport({
      provider,
      model: 'test-model',
      originalText: SENTENCE,
      sentenceCore: core(),
      temperature: 0.1,
    })
    const [readingGuideOutcome, structureOutcome] = await Promise.all([readingGuide, structure])
    expect(readingGuideOutcome.success).toBe(false)
    expect(structureOutcome.success).toBe(true)
  })
})

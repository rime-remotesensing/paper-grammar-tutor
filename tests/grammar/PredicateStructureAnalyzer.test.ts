import { describe, expect, it } from 'vitest'
import { analyzePredicateStructure } from '../../src/features/grammar/domain/PredicateStructureAnalyzer'
import type {
  GenerateStructuredRequest,
  GenerateStructuredResult,
  HealthStatus,
  LLMProvider,
  ModelInfo,
} from '../../src/llm/types'

const SENTENCE = 'The sensor collected data and analyzed the results.'

class StubProvider implements LLMProvider {
  callCount = 0
  private readonly responses: string[]

  constructor(responses: string[]) {
    this.responses = responses
  }

  async listModels(): Promise<ModelInfo[]> {
    return []
  }

  async healthCheck(): Promise<HealthStatus> {
    return { ok: true, message: 'ok' }
  }

  async generateStructured(_request: GenerateStructuredRequest): Promise<GenerateStructuredResult> {
    const rawText = this.responses[Math.min(this.callCount, this.responses.length - 1)]
    this.callCount += 1
    return { rawText, elapsedMs: 1 }
  }
}

const VALID_RESPONSE = JSON.stringify({
  subjectModifiers: [],
  predicates: [
    { text: 'collected', relation: 'main', dependents: [{ text: 'data', role: 'object', children: [] }] },
    { text: 'analyzed', relation: 'coordinated', dependents: [{ text: 'the results', role: 'object', children: [] }] },
  ],
  sentenceModifiers: [],
})

describe('analyzePredicateStructure', () => {
  it('succeeds on the first valid, well-grounded response', async () => {
    const provider = new StubProvider([VALID_RESPONSE])
    const result = await analyzePredicateStructure({ provider, model: 'test-model', sentence: SENTENCE, temperature: 0.1 })

    expect(result.success).toBe(true)
    if (!result.success) return
    expect(provider.callCount).toBe(1)
    expect(result.structure.predicates.map((p) => p.text)).toEqual(['collected', 'analyzed'])
    expect(result.structure.predicates[0].relation).toBe('main')
    expect(result.structure.predicates[1].relation).toBe('coordinated')
  })

  it('repairs once when the first response is invalid JSON, then succeeds', async () => {
    const provider = new StubProvider(['not valid json', VALID_RESPONSE])
    const result = await analyzePredicateStructure({ provider, model: 'test-model', sentence: SENTENCE, temperature: 0.1 })

    expect(result.success).toBe(true)
    expect(provider.callCount).toBe(2)
  })

  it('repairs once when a predicate text does not resolve, then succeeds', async () => {
    const ungrounded = JSON.stringify({
      subjectModifiers: [],
      predicates: [{ text: 'this is not in the sentence at all', relation: 'main', dependents: [] }],
      sentenceModifiers: [],
    })
    const provider = new StubProvider([ungrounded, VALID_RESPONSE])
    const result = await analyzePredicateStructure({ provider, model: 'test-model', sentence: SENTENCE, temperature: 0.1 })

    expect(result.success).toBe(true)
    expect(provider.callCount).toBe(2)
  })

  it('fails safely (without throwing) when the repair attempt also fails', async () => {
    const provider = new StubProvider(['not valid json', 'still not valid json'])
    const result = await analyzePredicateStructure({ provider, model: 'test-model', sentence: SENTENCE, temperature: 0.1 })

    expect(result.success).toBe(false)
    expect(provider.callCount).toBe(2)
    if (result.success) return
    expect(result.error.length).toBeGreaterThan(0)
  })

  it('fails safely when predicates is empty, even after one repair', async () => {
    const empty = JSON.stringify({ subjectModifiers: [], predicates: [], sentenceModifiers: [] })
    const provider = new StubProvider([empty, empty])
    const result = await analyzePredicateStructure({ provider, model: 'test-model', sentence: SENTENCE, temperature: 0.1 })

    expect(result.success).toBe(false)
    expect(provider.callCount).toBe(2)
  })

  it('never issues more than one repair call (no repair loops)', async () => {
    const provider = new StubProvider(['bad', 'bad', 'bad', VALID_RESPONSE])
    await analyzePredicateStructure({ provider, model: 'test-model', sentence: SENTENCE, temperature: 0.1 })
    expect(provider.callCount).toBe(2)
  })
})

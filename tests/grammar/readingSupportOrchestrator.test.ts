import { beforeEach, describe, expect, it } from 'vitest'
import { startReadingSupport } from '../../src/features/grammar/domain/readingSupportOrchestrator'
import { resetPredicateStructureCache } from '../../src/features/grammar/domain/predicateStructureService'
import type { SentenceCore } from '../../src/features/grammar/schemas/grammarAnalysis.schema'
import type { GenerateStructuredRequest, GenerateStructuredResult, HealthStatus, LLMProvider, ModelInfo } from '../../src/llm/types'

const SENTENCE = 'The sensor collected data.'
const CORE: SentenceCore = {
  subject: { text: 'The sensor', start: 0, end: 10 }, subjectHead: { text: 'sensor', start: 4, end: 10 },
  verb: { text: 'collected', start: 11, end: 20 }, indirectObject: null,
  object: { text: 'data', start: 21, end: 25 }, complement: null, pattern: 'SVO',
}
const STRUCTURE = JSON.stringify({
  subjectModifiers: [], predicates: [{ text: 'collected', relation: 'main', dependents: [{ text: 'data', role: 'object', children: [] }] }], sentenceModifiers: [],
})

class Provider implements LLMProvider {
  prompts: string[] = []
  async listModels(): Promise<ModelInfo[]> { return [] }
  async healthCheck(): Promise<HealthStatus> { return { ok: true, message: 'ok' } }
  async generateStructured(request: GenerateStructuredRequest): Promise<GenerateStructuredResult> {
    this.prompts.push(request.systemPrompt)
    return { rawText: STRUCTURE, elapsedMs: 1 }
  }
}

beforeEach(resetPredicateStructureCache)

describe('startReadingSupport — B6 Tree authority phase', () => {
  it('starts Structure authority but deliberately does not start ReadingGuide', async () => {
    const provider = new Provider()
    const promises = startReadingSupport({ provider, model: 'test-model', originalText: SENTENCE, sentenceCore: CORE, temperature: 0.1 })
    expect('readingGuide' in promises).toBe(false)
    expect(provider.prompts).toHaveLength(1)
    expect(provider.prompts[0]).toContain('ONLY the grammatical structure')
    expect((await promises.structure).success).toBe(true)
  })

  it('does not add any call when relative-link prefilter is false', () => {
    const provider = new Provider()
    const promises = startReadingSupport({ provider, model: 'test-model', originalText: SENTENCE, sentenceCore: CORE, temperature: 0.1 })
    expect(promises.relativeLink).toBeNull()
    expect(provider.prompts).toHaveLength(1)
    void promises.structure
  })
})

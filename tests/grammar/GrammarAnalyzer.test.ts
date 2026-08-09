import { describe, expect, it } from 'vitest'
import { analyzeSentence } from '../../src/features/grammar/domain/GrammarAnalyzer'
import type {
  GenerateStructuredRequest,
  GenerateStructuredResult,
  HealthStatus,
  LLMProvider,
  ModelInfo,
} from '../../src/llm/types'
import { SAMPLE_SENTENCE, validAnalysisFixture } from '../fixtures/validAnalysisFixture'

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

describe('analyzeSentence', () => {
  it('returns a valid analysis without regeneration on the first successful response', async () => {
    const provider = new StubProvider([JSON.stringify(validAnalysisFixture)])
    const result = await analyzeSentence({
      provider,
      model: 'test-model',
      sentence: SAMPLE_SENTENCE,
      temperature: 0.1,
    })

    expect(result.meta.schemaValid).toBe(true)
    expect(result.meta.regenerated).toBe(false)
    expect(provider.callCount).toBe(1)
    expect(result.analysis.sentenceCore.verb?.text).toBe('indicate')
    expect(result.analysis.originalText).toBe(SAMPLE_SENTENCE)
    expect(result.analysis.uncertainties).toEqual([])
    // pattern is derived by the app, not taken from the LLM response (which doesn't
    // even include a `pattern` field): object is filled and complement/indirectObject
    // are null, so this must derive to SVO.
    expect(result.analysis.sentenceCore.pattern).toBe('SVO')
  })

  it('derives pattern from constituents even if the LLM output would have implied a different one', async () => {
    // No `pattern` field exists in LlmGrammarAnalysis at all, so there is nothing for
    // the model to contradict itself with — this guards against that class of bug
    // (Prototype 0 baseline saw the LLM's own "pattern" answer disagree with the S/V/O/C
    // spans it had just produced) coming back if the schema is ever changed again.
    const svocFixture = {
      ...validAnalysisFixture,
      sentenceCore: {
        ...validAnalysisFixture.sentenceCore,
        object: { text: 'The results', start: 0, end: 11 },
        complement: { text: 'obtained', start: 12, end: 20 },
      },
    }
    const provider = new StubProvider([JSON.stringify(svocFixture)])
    const result = await analyzeSentence({
      provider,
      model: 'test-model',
      sentence: SAMPLE_SENTENCE,
      temperature: 0.1,
    })

    expect(result.analysis.sentenceCore.pattern).toBe('SVOC')
  })

  it('repairs once when the first response is invalid, then succeeds', async () => {
    const provider = new StubProvider(['not valid json', JSON.stringify(validAnalysisFixture)])
    const result = await analyzeSentence({
      provider,
      model: 'test-model',
      sentence: SAMPLE_SENTENCE,
      temperature: 0.1,
    })

    expect(result.meta.regenerated).toBe(true)
    expect(result.meta.schemaValid).toBe(true)
    expect(provider.callCount).toBe(2)
  })

  it('falls back to a safe empty analysis when repair also fails, without throwing', async () => {
    const provider = new StubProvider(['not valid json', 'still not valid json'])
    const result = await analyzeSentence({
      provider,
      model: 'test-model',
      sentence: SAMPLE_SENTENCE,
      temperature: 0.1,
    })

    expect(result.meta.schemaValid).toBe(false)
    expect(provider.callCount).toBe(2)
    expect(result.analysis.needsMoreContext).toBe(true)
    expect(result.analysis.confidence).toBe(0)
    expect(result.analysis.uncertainties.length).toBeGreaterThan(0)
  })

  it('flags spans the model reports that do not appear in the sentence', async () => {
    const badSpanFixture = {
      ...validAnalysisFixture,
      sentenceCore: {
        ...validAnalysisFixture.sentenceCore,
        verb: { text: 'this phrase is not in the sentence', start: 0, end: 5 },
      },
    }
    const provider = new StubProvider([JSON.stringify(badSpanFixture)])
    const result = await analyzeSentence({
      provider,
      model: 'test-model',
      sentence: SAMPLE_SENTENCE,
      temperature: 0.1,
    })

    expect(result.analysis.sentenceCore.verb?.start).toBe(-1)
    expect(result.analysis.uncertainties.some((u) => u.includes('主動詞'))).toBe(true)
  })
})

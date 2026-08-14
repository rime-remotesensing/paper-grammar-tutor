import { describe, expect, it } from 'vitest'
import {
  isSentenceCoreFailure,
  mergeRecoveredSentenceCore,
  recoverSentenceCore,
} from '../../src/features/grammar/domain/sentenceCoreRecovery'
import type { GrammarAnalysis } from '../../src/features/grammar/schemas/grammarAnalysis.schema'
import type {
  GenerateStructuredRequest,
  GenerateStructuredResult,
  HealthStatus,
  LLMProvider,
  ModelInfo,
} from '../../src/llm/types'
import { validAnalysisFixture } from '../fixtures/validAnalysisFixture'

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

class ThrowingProvider implements LLMProvider {
  async listModels(): Promise<ModelInfo[]> {
    return []
  }
  async healthCheck(): Promise<HealthStatus> {
    return { ok: true, message: 'ok' }
  }
  async generateStructured(): Promise<GenerateStructuredResult> {
    throw new Error('network unreachable')
  }
}

const FULL_ANALYSIS: GrammarAnalysis = {
  ...validAnalysisFixture,
  sentenceCore: { ...validAnalysisFixture.sentenceCore, pattern: 'SVO' },
  originalText: 'Data was recorded.',
  normalizedText: 'Data was recorded.',
}

function span(text: string, start: number, end: number) {
  return { text, start, end }
}

describe('isSentenceCoreFailure', () => {
  it('is true when subject is null', () => {
    expect(isSentenceCoreFailure({ subject: null, subjectHead: null, verb: span('was recorded', 5, 17) })).toBe(
      true,
    )
  })

  it('is true when verb is null', () => {
    expect(isSentenceCoreFailure({ subject: span('Data', 0, 4), subjectHead: span('Data', 0, 4), verb: null })).toBe(
      true,
    )
  })

  it('passes for a normal case: adjacent (non-overlapping) subject and verb', () => {
    // subject ends exactly where verb starts — merely adjacent, not an overlap.
    const core = { subject: span('Data', 0, 4), subjectHead: span('Data', 0, 4), verb: span('was recorded', 4, 16) }
    expect(isSentenceCoreFailure(core)).toBe(false)
  })

  it('is true when subject and verb partially overlap', () => {
    // subject [0,10), verb [8,20) — overlapping ranges, neither contains the other.
    const core = {
      subject: span('The sensor rec', 0, 10),
      subjectHead: span('sensor', 4, 10),
      verb: span('recorded data', 8, 20),
    }
    expect(isSentenceCoreFailure(core)).toBe(true)
  })

  it('is true when verb is fully inside subject (the real bug: subject swallows the whole clause)', () => {
    // Reproduces the observed case: subject="The sensor recorded data" [0,24],
    // verb="recorded" [11,19] entirely inside it.
    const core = {
      subject: span('The sensor recorded data', 0, 24),
      subjectHead: span('sensor', 4, 10),
      verb: span('recorded', 11, 19),
    }
    expect(isSentenceCoreFailure(core)).toBe(true)
  })

  it('is true when subject is fully inside verb', () => {
    const core = { subject: span('sensor', 4, 10), subjectHead: span('sensor', 4, 10), verb: span('The sensor recorded', 0, 20) }
    expect(isSentenceCoreFailure(core)).toBe(true)
  })

  it('passes when subjectHead is inside subject', () => {
    const core = {
      subject: span('The results obtained in the previous experiment', 0, 49),
      subjectHead: span('The results', 0, 11),
      verb: span('indicate', 50, 58),
    }
    expect(isSentenceCoreFailure(core)).toBe(false)
  })

  it('passes when subjectHead exactly matches subject boundaries', () => {
    const core = {
      subject: span('Reducing measurement error', 0, 27),
      subjectHead: span('Reducing measurement error', 0, 27),
      verb: span('remains', 28, 35),
    }
    expect(isSentenceCoreFailure(core)).toBe(false)
  })

  it('is true when subjectHead starts before subject', () => {
    const core = {
      subject: span('sensor', 4, 10),
      subjectHead: span('The sensor', 0, 10),
      verb: span('recorded', 11, 19),
    }
    expect(isSentenceCoreFailure(core)).toBe(true)
  })

  it('is true when subjectHead ends after subject', () => {
    const core = {
      subject: span('The sensor', 0, 10),
      subjectHead: span('sensor recorded', 4, 19),
      verb: span('recorded', 11, 19),
    }
    expect(isSentenceCoreFailure(core)).toBe(true)
  })

  it('does not fail on subjectHead alone being null', () => {
    const core = { subject: span('Data', 0, 4), subjectHead: null, verb: span('was recorded', 5, 17) }
    expect(isSentenceCoreFailure(core)).toBe(false)
  })

  it('is false regardless of object/complement being null (only S/V/subjectHead matter)', () => {
    const coreLikeWithNullObjectAndComplement = {
      subject: span('Data', 0, 4),
      subjectHead: span('Data', 0, 4),
      verb: span('was recorded', 5, 17),
      object: null,
      complement: null,
    }
    expect(isSentenceCoreFailure(coreLikeWithNullObjectAndComplement)).toBe(false)
  })

  describe('complex subjects (verb outside subject must still pass)', () => {
    it('passes for a participle-modified subject', () => {
      // "The results obtained in the previous experiment indicate a clear trend."
      const core = {
        subject: span('The results obtained in the previous experiment', 0, 47),
        subjectHead: span('The results', 0, 11),
        verb: span('indicate', 48, 56),
      }
      expect(isSentenceCoreFailure(core)).toBe(false)
    })

    it('passes for a subject containing its own relative clause with a subordinate verb', () => {
      // "The method that was proposed previously performs well." — the subordinate verb
      // "was proposed" is entirely inside subject, but sentenceCore.verb is "performs",
      // which is outside subject — this must NOT be flagged.
      const core = {
        subject: span('The method that was proposed previously', 0, 39),
        subjectHead: span('method', 4, 10),
        verb: span('performs', 40, 48),
      }
      expect(isSentenceCoreFailure(core)).toBe(false)
    })
  })
})

describe('mergeRecoveredSentenceCore', () => {
  // A minimal recovered core (mandatory fields only, all optionals null) reused across
  // most cases below — each test overrides just the field(s) it's exercising.
  const recoveredBase = {
    subject: span('The sensor', 0, 10),
    subjectHead: span('sensor', 4, 10),
    verb: span('recorded', 11, 19),
    indirectObject: null,
    object: null,
    complement: null,
    pattern: 'SV' as const,
  }

  it('1. keeps the original object when the recovered object is null', () => {
    const original = { ...FULL_ANALYSIS.sentenceCore, object: span('data', 20, 24) }
    const analysis = { ...FULL_ANALYSIS, sentenceCore: original }
    const merged = mergeRecoveredSentenceCore(analysis, { ...recoveredBase, object: null })
    expect(merged.sentenceCore.object).toEqual(span('data', 20, 24))
  })

  it('2. uses the recovered object when the original had none', () => {
    const original = { ...FULL_ANALYSIS.sentenceCore, object: null }
    const analysis = { ...FULL_ANALYSIS, sentenceCore: original }
    const merged = mergeRecoveredSentenceCore(analysis, { ...recoveredBase, object: span('data', 20, 24) })
    expect(merged.sentenceCore.object).toEqual(span('data', 20, 24))
  })

  it('3. stays null when both original and recovered object are null', () => {
    const original = { ...FULL_ANALYSIS.sentenceCore, object: null }
    const analysis = { ...FULL_ANALYSIS, sentenceCore: original }
    const merged = mergeRecoveredSentenceCore(analysis, { ...recoveredBase, object: null })
    expect(merged.sentenceCore.object).toBeNull()
  })

  it('4. keeps the original complement when the recovered complement is null', () => {
    const original = { ...FULL_ANALYSIS.sentenceCore, complement: span('convincing', 30, 40) }
    const analysis = { ...FULL_ANALYSIS, sentenceCore: original }
    const merged = mergeRecoveredSentenceCore(analysis, { ...recoveredBase, complement: null })
    expect(merged.sentenceCore.complement).toEqual(span('convincing', 30, 40))
  })

  it('5. always takes subject/subjectHead/verb from the recovered core, never the original', () => {
    const original = {
      ...FULL_ANALYSIS.sentenceCore,
      subject: span('The sensor recorded data', 0, 24),
      subjectHead: span('sensor', 4, 10),
      verb: span('recorded', 11, 19),
    }
    const analysis = { ...FULL_ANALYSIS, sentenceCore: original }
    const merged = mergeRecoveredSentenceCore(analysis, recoveredBase)
    expect(merged.sentenceCore.subject).toEqual(recoveredBase.subject)
    expect(merged.sentenceCore.subjectHead).toEqual(recoveredBase.subjectHead)
    expect(merged.sentenceCore.verb).toEqual(recoveredBase.verb)
  })

  it('6. recomputes pattern from the final merged constituents (regression case)', () => {
    // Reproduces the real bug this conservative merge fixes: original full analysis had
    // an over-scoped subject but a CORRECT object ("data", pattern SVO); recovered fixed
    // subject but, on this run, didn't repeat object. A blind overwrite would have lost
    // "data" and downgraded the pattern to SV — the conservative merge must not.
    const original = {
      subject: span('The sensor recorded data', 0, 24),
      subjectHead: span('sensor', 4, 10),
      verb: span('recorded', 11, 19),
      indirectObject: null,
      object: span('data', 20, 24),
      complement: null,
      pattern: 'SVO' as const,
    }
    const analysis = { ...FULL_ANALYSIS, sentenceCore: original }
    const recovered = {
      subject: span('The sensor', 0, 10),
      subjectHead: span('sensor', 4, 10),
      verb: span('recorded', 11, 19),
      indirectObject: null,
      object: null,
      complement: null,
      pattern: 'SV' as const,
    }
    const merged = mergeRecoveredSentenceCore(analysis, recovered)

    expect(merged.sentenceCore).toEqual({
      subject: span('The sensor', 0, 10),
      subjectHead: span('sensor', 4, 10),
      verb: span('recorded', 11, 19),
      indirectObject: null,
      object: span('data', 20, 24),
      complement: null,
      pattern: 'SVO',
    })
  })

  it('preserves every non-sentenceCore field on the analysis untouched', () => {
    const merged = mergeRecoveredSentenceCore(FULL_ANALYSIS, recoveredBase)
    expect(merged.chunks).toBe(FULL_ANALYSIS.chunks)
    expect(merged.modifiers).toBe(FULL_ANALYSIS.modifiers)
    expect(merged.clauses).toBe(FULL_ANALYSIS.clauses)
    expect(merged.phrases).toBe(FULL_ANALYSIS.phrases)
    expect(merged.vocabulary).toBe(FULL_ANALYSIS.vocabulary)
    expect(merged.readingHint).toBe(FULL_ANALYSIS.readingHint)
    expect(merged.confidence).toBe(FULL_ANALYSIS.confidence)
    expect(merged.uncertainties).toBe(FULL_ANALYSIS.uncertainties)
    expect(merged.needsMoreContext).toBe(FULL_ANALYSIS.needsMoreContext)
    expect(merged.referenceTranslation).toBe(FULL_ANALYSIS.referenceTranslation)
    expect(merged.originalText).toBe(FULL_ANALYSIS.originalText)
    expect(merged.normalizedText).toBe(FULL_ANALYSIS.normalizedText)
  })
})

describe('recoverSentenceCore', () => {
  const sentence = 'Data was recorded.'

  it('resolves spans and derives the pattern on a valid forced-core response', async () => {
    const raw = JSON.stringify({
      subject: { text: 'Data', start: 0, end: 4 },
      subjectHead: { text: 'Data', start: 0, end: 4 },
      verb: { text: 'was recorded', start: 5, end: 17 },
      indirectObject: null,
      object: null,
      complement: null,
    })
    const provider = new StubProvider([raw])
    const result = await recoverSentenceCore({ provider, model: 'test-model', sentence, temperature: 0.1 })

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.sentenceCore.subject?.text).toBe('Data')
      expect(result.sentenceCore.verb?.text).toBe('was recorded')
      expect(result.sentenceCore.pattern).toBe('SV')
    }
  })

  it('re-locates offsets even if the model reported wrong start/end', async () => {
    const raw = JSON.stringify({
      subject: { text: 'Data', start: 999, end: 999 }, // deliberately wrong
      subjectHead: { text: 'Data', start: 999, end: 999 },
      verb: { text: 'was recorded', start: 999, end: 999 },
      indirectObject: null,
      object: null,
      complement: null,
    })
    const provider = new StubProvider([raw])
    const result = await recoverSentenceCore({ provider, model: 'test-model', sentence, temperature: 0.1 })

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.sentenceCore.subject).toEqual({ text: 'Data', start: 0, end: 4 })
      expect(result.sentenceCore.verb).toEqual({ text: 'was recorded', start: 5, end: 17 })
    }
  })

  it('fails cleanly (does not throw) when the response is not valid JSON', async () => {
    const provider = new StubProvider(['not valid json'])
    const result = await recoverSentenceCore({ provider, model: 'test-model', sentence, temperature: 0.1 })

    expect(result.success).toBe(false)
  })

  it('fails cleanly when the response violates the forced-core schema (null subject)', async () => {
    const raw = JSON.stringify({
      subject: null,
      subjectHead: null,
      verb: { text: 'was recorded', start: 5, end: 17 },
      indirectObject: null,
      object: null,
      complement: null,
    })
    const provider = new StubProvider([raw])
    const result = await recoverSentenceCore({ provider, model: 'test-model', sentence, temperature: 0.1 })

    expect(result.success).toBe(false)
  })

  it('refuses to return a recovered core that is itself structurally broken (subject overlaps verb)', async () => {
    // Even the forced-core call can repeat the same "subject swallows the whole clause"
    // mistake observed in production. The schema forbids null subject/verb here, but
    // nothing stops the model from returning an overlapping span — recoverSentenceCore
    // must catch that itself and refuse to hand back a broken core, rather than relying
    // on the caller to notice.
    const raw = JSON.stringify({
      subject: { text: 'The sensor recorded data', start: 0, end: 24 },
      subjectHead: { text: 'sensor', start: 4, end: 10 },
      verb: { text: 'recorded', start: 11, end: 19 },
      indirectObject: null,
      object: { text: 'data', start: 20, end: 24 },
      complement: null,
    })
    const provider = new StubProvider([raw])
    const result = await recoverSentenceCore({
      provider,
      model: 'test-model',
      sentence: 'The sensor recorded data.',
      temperature: 0.1,
    })

    expect(result.success).toBe(false)
  })

  it('fails cleanly (does not throw) when the provider call itself throws', async () => {
    const provider = new ThrowingProvider()
    await expect(
      recoverSentenceCore({ provider, model: 'test-model', sentence, temperature: 0.1 }),
    ).rejects.toThrow()
    // Note: recoverSentenceCore itself does not catch provider-level errors — the caller
    // (AnalysisResultPanel's handleRecoverCore) wraps the call in try/catch so a thrown
    // network error becomes the same local "recovery failed" UI state, never an app crash.
  })
})

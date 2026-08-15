import { beforeEach, describe, expect, it } from 'vitest'
import { analyzeSentenceWithAutoRecovery } from '../../src/features/grammar/domain/analyzeSentenceWithAutoRecovery'
import { resetFocusedSubjectVerbRepairCache } from '../../src/features/grammar/domain/focusedSubjectVerbRepairService'
import type { LlmGrammarAnalysis } from '../../src/features/grammar/schemas/grammarAnalysis.schema'
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

function span(text: string, start: number, end: number) {
  return { text, start, end }
}

beforeEach(() => {
  resetFocusedSubjectVerbRepairCache()
})

describe('analyzeSentenceWithAutoRecovery — normal valid core', () => {
  it('makes exactly 1 GrammarAnalysis call and 0 forced-core calls, and does not run recovery', async () => {
    const provider = new StubProvider([JSON.stringify(validAnalysisFixture)])
    const phases: string[] = []
    const outcome = await analyzeSentenceWithAutoRecovery({
      provider,
      model: 'test-model',
      sentence: SAMPLE_SENTENCE,
      temperature: 0.1,
      onPhaseChange: (p) => phases.push(p),
    })

    expect(outcome.success).toBe(true)
    if (!outcome.success) return
    expect(outcome.recoveryUsed).toBe(false)
    expect(outcome.coreRepair).toEqual({ failureReason: 'NONE', strategy: 'none', status: 'not-needed' })
    expect(provider.callCount).toBe(1)
    expect(phases).toEqual(['analyzing'])
    expect(outcome.result.analysis.sentenceCore.verb?.text).toBe('indicate')
  })
})

describe('analyzeSentenceWithAutoRecovery — "Data was recorded..." null-subject auto-recovery', () => {
  it('automatically recovers with exactly 1 forced-core call, no user action required', async () => {
    const emptyCoreFixture: LlmGrammarAnalysis = {
      ...validAnalysisFixture,
      sentenceCore: {
        subject: null,
        subjectHead: null,
        verb: null,
        indirectObject: null,
        object: null,
        complement: null,
      },
    }
    const forcedCoreResponse = JSON.stringify({
      subject: span('Data', 0, 4),
      subjectHead: span('Data', 0, 4),
      verb: span('was recorded', 5, 17),
      indirectObject: null,
      object: null,
      complement: null,
    })
    const provider = new StubProvider([JSON.stringify(emptyCoreFixture), forcedCoreResponse])
    const phases: string[] = []
    const outcome = await analyzeSentenceWithAutoRecovery({
      provider,
      model: 'test-model',
      sentence: 'Data was recorded.',
      temperature: 0.1,
      onPhaseChange: (p) => phases.push(p),
    })

    expect(outcome.success).toBe(true)
    if (!outcome.success) return
    expect(outcome.recoveryUsed).toBe(true)
    expect(outcome.coreRepair).toEqual({ failureReason: 'NULL_SUBJECT', strategy: 'forced-core', status: 'repaired' })
    expect(provider.callCount).toBe(2)
    expect(phases).toEqual(['analyzing', 'confirmingCore'])
    expect(outcome.result.analysis.sentenceCore.subject?.text).toBe('Data')
    expect(outcome.result.analysis.sentenceCore.verb?.text).toBe('was recorded')
    expect(outcome.result.analysis.sentenceCore.pattern).toBe('SV')
  })
})

describe('analyzeSentenceWithAutoRecovery — "The sensor recorded data." overlap auto-recovery (Prototype 2.3L: Focused Subject-Verb Repair, not forced-core)', () => {
  it('routes SUBJECT_VERB_OVERLAP to Focused Subject-Verb Repair and preserves the original object', async () => {
    const overlappingFixture: LlmGrammarAnalysis = {
      ...validAnalysisFixture,
      sentenceCore: {
        subject: span('The sensor recorded data', 0, 25),
        subjectHead: span('sensor', 4, 10),
        verb: span('recorded', 11, 19),
        indirectObject: null,
        object: span('data', 20, 24),
        complement: null,
      },
    }
    // Focused Subject-Verb Repair's schema is {subject, subjectHead, verb} ONLY — no
    // indirectObject/object/complement (item 9 of the 2.3L order), unlike forced-core's
    // full-core response shape.
    const focusedSvResponse = JSON.stringify({
      subject: 'The sensor',
      subjectHead: 'sensor',
      verb: 'recorded',
    })
    const provider = new StubProvider([JSON.stringify(overlappingFixture), focusedSvResponse])
    const phases: string[] = []
    const outcome = await analyzeSentenceWithAutoRecovery({
      provider,
      model: 'test-model',
      sentence: 'The sensor recorded data.',
      temperature: 0.1,
      onPhaseChange: (p) => phases.push(p),
    })

    expect(outcome.success).toBe(true)
    if (!outcome.success) return
    expect(outcome.recoveryUsed).toBe(true)
    expect(outcome.coreRepair).toEqual({ failureReason: 'SUBJECT_VERB_OVERLAP', strategy: 'focused-sv', status: 'repaired' })
    expect(provider.callCount).toBe(2)
    expect(phases).toEqual(['analyzing', 'repairingSubjectVerb'])
    const core = outcome.result.analysis.sentenceCore
    expect(core.subject?.text).toBe('The sensor')
    expect(core.verb?.text).toBe('recorded')
    expect(core.object?.text).toBe('data') // preserved from the raw core, never regenerated
    expect(core.pattern).toBe('SVO')
  })

  it('does not cascade to forced-core when Focused Subject-Verb Repair fails technically (item 25: safe failure, not blind fallback)', async () => {
    const overlappingFixture: LlmGrammarAnalysis = {
      ...validAnalysisFixture,
      sentenceCore: {
        subject: span('The sensor recorded data', 0, 25),
        subjectHead: span('sensor', 4, 10),
        verb: span('recorded', 11, 19),
        indirectObject: null,
        object: span('data', 20, 24),
        complement: null,
      },
    }
    const provider = new StubProvider([JSON.stringify(overlappingFixture), 'not valid json', 'still not valid json'])
    const outcome = await analyzeSentenceWithAutoRecovery({
      provider,
      model: 'test-model',
      sentence: 'The sensor recorded data.',
      temperature: 0.1,
    })

    expect(outcome.success).toBe(false)
    // 1 GrammarAnalysis call + at most 1 repair attempt inside Focused S/V Repair itself
    // (MAX_REPAIR_ATTEMPTS=1) — never a THIRD call cascading into forced-core.
    expect(provider.callCount).toBe(3)
  })
})

describe('analyzeSentenceWithAutoRecovery — subjectHead outside subject auto-recovery', () => {
  it('triggers exactly 1 forced-core call when subjectHead is not contained within subject', async () => {
    const badContainmentFixture: LlmGrammarAnalysis = {
      ...validAnalysisFixture,
      sentenceCore: {
        subject: span('sensor', 4, 10),
        subjectHead: span('The sensor recorded', 0, 20),
        verb: span('data', 21, 25),
        indirectObject: null,
        object: null,
        complement: null,
      },
    }
    const forcedCoreResponse = JSON.stringify({
      subject: span('The sensor', 0, 10),
      subjectHead: span('sensor', 4, 10),
      verb: span('recorded', 11, 19),
      indirectObject: null,
      object: span('data', 20, 24),
      complement: null,
    })
    const provider = new StubProvider([JSON.stringify(badContainmentFixture), forcedCoreResponse])
    const outcome = await analyzeSentenceWithAutoRecovery({
      provider,
      model: 'test-model',
      sentence: 'The sensor recorded data.',
      temperature: 0.1,
    })

    expect(provider.callCount).toBe(2)
    expect(outcome.success).toBe(true)
  })
})

describe('analyzeSentenceWithAutoRecovery — forced-recovery failure', () => {
  it('ends in a final error state without looping when the forced-core response is invalid', async () => {
    const emptyCoreFixture: LlmGrammarAnalysis = {
      ...validAnalysisFixture,
      sentenceCore: { subject: null, subjectHead: null, verb: null, indirectObject: null, object: null, complement: null },
    }
    const provider = new StubProvider([JSON.stringify(emptyCoreFixture), 'not valid json'])
    const outcome = await analyzeSentenceWithAutoRecovery({
      provider,
      model: 'test-model',
      sentence: 'Data was recorded.',
      temperature: 0.1,
    })

    expect(outcome.success).toBe(false)
    // Exactly 2 calls total: the primary GrammarAnalysis call plus ONE forced-core
    // attempt — recoverSentenceCore itself has no retry loop, and
    // analyzeSentenceWithAutoRecovery must not add one on top.
    expect(provider.callCount).toBe(2)
    if (outcome.success) return
    expect(outcome.error.length).toBeGreaterThan(0)
  })

  it('ends in a final error state when the forced-core result is itself structurally broken', async () => {
    const emptyCoreFixture: LlmGrammarAnalysis = {
      ...validAnalysisFixture,
      sentenceCore: { subject: null, subjectHead: null, verb: null, indirectObject: null, object: null, complement: null },
    }
    // Forced-core response repeats the "subject swallows the clause" mistake.
    const brokenForcedCore = JSON.stringify({
      subject: span('Data was recorded', 0, 18),
      subjectHead: span('Data', 0, 4),
      verb: span('was recorded', 5, 17),
      indirectObject: null,
      object: null,
      complement: null,
    })
    const provider = new StubProvider([JSON.stringify(emptyCoreFixture), brokenForcedCore])
    const outcome = await analyzeSentenceWithAutoRecovery({
      provider,
      model: 'test-model',
      sentence: 'Data was recorded.',
      temperature: 0.1,
    })

    expect(outcome.success).toBe(false)
    expect(provider.callCount).toBe(2)
  })

  it('catches a thrown provider error during forced-core recovery and fails safely', async () => {
    class ThrowsOnSecondCall implements LLMProvider {
      callCount = 0
      async listModels(): Promise<ModelInfo[]> {
        return []
      }
      async healthCheck(): Promise<HealthStatus> {
        return { ok: true, message: 'ok' }
      }
      async generateStructured(_request: GenerateStructuredRequest): Promise<GenerateStructuredResult> {
        this.callCount += 1
        if (this.callCount === 1) {
          return {
            rawText: JSON.stringify({
              ...validAnalysisFixture,
              sentenceCore: { subject: null, subjectHead: null, verb: null, indirectObject: null, object: null, complement: null },
            }),
            elapsedMs: 1,
          }
        }
        throw new Error('network unreachable')
      }
    }
    const provider = new ThrowsOnSecondCall()
    const outcome = await analyzeSentenceWithAutoRecovery({
      provider,
      model: 'test-model',
      sentence: 'Data was recorded.',
      temperature: 0.1,
    })

    expect(outcome.success).toBe(false)
    expect(provider.callCount).toBe(2)
  })
})

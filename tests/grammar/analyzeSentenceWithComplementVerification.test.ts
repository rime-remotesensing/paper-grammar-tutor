import { beforeEach, describe, expect, it } from 'vitest'
import { analyzeSentenceWithComplementVerification } from '../../src/features/grammar/domain/analyzeSentenceWithComplementVerification'
import { resetFocusedComplementVerifierCache } from '../../src/features/grammar/domain/focusedComplementVerifierService'
import { resetFocusedSubjectVerbRepairCache } from '../../src/features/grammar/domain/focusedSubjectVerbRepairService'
import { resetFocusedCopularCoreRepairCache } from '../../src/features/grammar/domain/focusedCopularCoreRepairService'
import { resetFocusedPassiveCoreRepairCache } from '../../src/features/grammar/domain/focusedPassiveCoreRepairService'
import type { LlmGrammarAnalysis, LlmSentenceCore } from '../../src/features/grammar/schemas/grammarAnalysis.schema'
import type {
  GenerateStructuredRequest,
  GenerateStructuredResult,
  HealthStatus,
  LLMProvider,
  ModelInfo,
} from '../../src/llm/types'

// Prototype 2.3I items 38/39 — effective-core derivation + full pipeline tests.

const SENTENCE = 'We describe the method, emphasizing its advantages.'

function singleCoreAnalysis(core: LlmSentenceCore): LlmGrammarAnalysis {
  return {
    sentenceCoreSet: {
      subject: core.subject,
      subjectHead: core.subjectHead,
      predicateCores: [{ connector: null, verb: core.verb, indirectObject: core.indirectObject, object: core.object, complement: core.complement }],
    },
    chunks: [], modifiers: [], clauses: [], phrases: [], vocabulary: [], readingHint: [],
    confidence: 0.9, uncertainties: [], needsMoreContext: false, referenceTranslation: null,
  }
}

const SVOC_CORE: LlmSentenceCore = {
    subject: { text: 'We', start: 0, end: 2 },
    subjectHead: { text: 'We', start: 0, end: 2 },
    verb: { text: 'describe', start: 3, end: 11 },
    indirectObject: null,
    object: { text: 'the method', start: 12, end: 22 },
    complement: { text: 'emphasizing its advantages', start: 24, end: 50 },
}
const SVOC_ANALYSIS = singleCoreAnalysis(SVOC_CORE)

const SVO_ANALYSIS = singleCoreAnalysis({ ...SVOC_CORE, complement: null })

// A comma-containing sentence whose gold classification is still OBJECT_COMPLEMENT
// (validated in the Prototype 2.3H spike: 14/15 direct-verifier runs) — needed so the
// suspicious gate actually FIRES (it requires a comma between object and complement) and
// this test can exercise the "gate true, verifier says OBJECT_COMPLEMENT" branch. A
// no-comma object-complement sentence like "We found the sensor operating normally."
// would never reach the verifier at all (see the no-comma negative-control test below).
const OBJECT_COMPLEMENT_SENTENCE = 'They discovered the file, missing several key entries.'
const OBJECT_COMPLEMENT_ANALYSIS = singleCoreAnalysis({
    subject: { text: 'They', start: 0, end: 4 },
    subjectHead: { text: 'They', start: 0, end: 4 },
    verb: { text: 'discovered', start: 5, end: 15 },
    indirectObject: null,
    object: { text: 'the file', start: 16, end: 24 },
    complement: { text: 'missing several key entries', start: 26, end: 53 },
  })

// No comma between object and complement at all — the gate must never fire here
// regardless of classification semantics (item 15: true SVOC must not add latency).
const NO_COMMA_SENTENCE = 'We found the sensor operating normally.'
const NO_COMMA_ANALYSIS = singleCoreAnalysis({
    subject: { text: 'We', start: 0, end: 2 },
    subjectHead: { text: 'We', start: 0, end: 2 },
    verb: { text: 'found', start: 3, end: 8 },
    indirectObject: null,
    object: { text: 'the sensor', start: 9, end: 19 },
    complement: { text: 'operating normally', start: 20, end: 39 },
  })

function focusedResponse(classification: string, reasonCode: string) {
  return JSON.stringify({ classification, reasonCode })
}

/** Routes by distinctive substrings in each prompt's SYSTEM_PROMPT so one stub can serve
 * GrammarAnalysis, forced-core recovery, AND the focused verifier independently. */
class RoutingProvider implements LLMProvider {
  grammarAnalysisCalls = 0
  forcedCoreCalls = 0
  focusedVerifierCalls = 0
  focusedSvCalls = 0
  focusedCopularCalls = 0
  focusedPassiveCalls = 0
  private readonly grammarAnalysisResponse: string
  private readonly focusedVerifierResponse: string | null
  private readonly focusedSvResponse: string | null
  private readonly focusedCopularResponse: string | null
  private readonly forcedCoreResponse: string | null
  private readonly focusedPassiveResponse: string | null

  constructor(
    grammarAnalysisResponse: string,
    focusedVerifierResponse: string | null,
    focusedSvResponse: string | null = null,
    focusedCopularResponse: string | null = null,
    forcedCoreResponse: string | null = null,
    focusedPassiveResponse: string | null = null,
  ) {
    this.grammarAnalysisResponse = grammarAnalysisResponse
    this.focusedVerifierResponse = focusedVerifierResponse
    this.focusedSvResponse = focusedSvResponse
    this.focusedCopularResponse = focusedCopularResponse
    this.forcedCoreResponse = forcedCoreResponse
    this.focusedPassiveResponse = focusedPassiveResponse
  }

  async listModels(): Promise<ModelInfo[]> {
    return []
  }

  async healthCheck(): Promise<HealthStatus> {
    return { ok: true, message: 'ok' }
  }

  async generateStructured(request: GenerateStructuredRequest): Promise<GenerateStructuredResult> {
    if (request.systemPrompt.includes("Identify ONLY the sentence's PRIMARY clause subject")) {
      this.focusedCopularCalls++
      if (this.focusedCopularResponse === null) throw new Error('Focused Copular Core Repair should not have been called')
      return { rawText: this.focusedCopularResponse, elapsedMs: 1 }
    }
    if (request.systemPrompt.includes('Given the sentence and its primary clause')) {
      this.focusedPassiveCalls++
      if (this.focusedPassiveResponse === null) throw new Error('Focused Passive-Core Repair should not have been called')
      return { rawText: this.focusedPassiveResponse, elapsedMs: 1 }
    }
    if (request.systemPrompt.includes('Decide ONE thing')) {
      this.focusedVerifierCalls++
      if (this.focusedVerifierResponse === null) throw new Error('focused verifier should not have been called')
      return { rawText: this.focusedVerifierResponse, elapsedMs: 1 }
    }
    if (request.systemPrompt.includes('Identify ONLY the MAIN CLAUSE subject and main verb')) {
      this.focusedSvCalls++
      if (this.focusedSvResponse === null) throw new Error('Focused Subject-Verb Repair should not have been called')
      return { rawText: this.focusedSvResponse, elapsedMs: 1 }
    }
    if (request.systemPrompt.includes('already confirmed is a full sentence')) {
      this.forcedCoreCalls++
      if (this.forcedCoreResponse === null) throw new Error('forced-core recovery should not have been called in this test')
      return { rawText: this.forcedCoreResponse, elapsedMs: 1 }
    }
    this.grammarAnalysisCalls++
    return { rawText: this.grammarAnalysisResponse, elapsedMs: 1 }
  }
}

beforeEach(() => {
  resetFocusedComplementVerifierCache()
  resetFocusedSubjectVerbRepairCache()
  resetFocusedCopularCoreRepairCache()
  resetFocusedPassiveCoreRepairCache()
})

describe('analyzeSentenceWithComplementVerification — effective core derivation', () => {
  it('OBJECT_COMPLEMENT: effectiveCore is unchanged (rawCore === effectiveCore)', async () => {
    const provider = new RoutingProvider(JSON.stringify(OBJECT_COMPLEMENT_ANALYSIS), focusedResponse('OBJECT_COMPLEMENT', 'OBJECT_PREDICATION'))
    const outcome = await analyzeSentenceWithComplementVerification({
      provider,
      model: 'test-model',
      sentence: OBJECT_COMPLEMENT_SENTENCE,
      temperature: 0.1,
    })
    expect(outcome.success).toBe(true)
    if (!outcome.success) return
    expect(outcome.result.verification.status).toBe('confirmed_object_complement')
    expect(outcome.result.effectiveCore).toEqual(outcome.result.rawCore)
    expect(outcome.result.effectiveCore.complement?.text).toBe('missing several key entries')
    expect(outcome.result.effectiveCore.pattern).toBe('SVOC')
    expect(provider.focusedVerifierCalls).toBe(1)
  })

  it('SUPPLEMENTARY_ING: effectiveCore has complement=null and pattern re-derived to SVO', async () => {
    const provider = new RoutingProvider(JSON.stringify(SVOC_ANALYSIS), focusedResponse('SUPPLEMENTARY_ING', 'COMMA_SUPPLEMENT'))
    const outcome = await analyzeSentenceWithComplementVerification({ provider, model: 'test-model', sentence: SENTENCE, temperature: 0.1 })
    expect(outcome.success).toBe(true)
    if (!outcome.success) return
    expect(outcome.result.verification.status).toBe('confirmed_supplementary_ing')
    expect(outcome.result.effectiveCore.complement).toBeNull()
    expect(outcome.result.effectiveCore.pattern).toBe('SVO')
    expect(outcome.result.effectiveCore.object?.text).toBe('the method')
    // rawCore is untouched — the original (bogus) complement is still there for debug.
    expect(outcome.result.rawCore.complement?.text).toBe('emphasizing its advantages')
    expect(outcome.result.rawCore.pattern).toBe('SVOC')
    // analysis.sentenceCore (the raw GrammarAnalysis result) is never mutated.
    expect(outcome.result.analysis.sentenceCore.complement?.text).toBe('emphasizing its advantages')
  })

  it('UNCERTAIN: effectiveCore left equal to rawCore, status is uncertain', async () => {
    const provider = new RoutingProvider(JSON.stringify(SVOC_ANALYSIS), focusedResponse('UNCERTAIN', 'INSUFFICIENT_EVIDENCE'))
    const outcome = await analyzeSentenceWithComplementVerification({ provider, model: 'test-model', sentence: SENTENCE, temperature: 0.1 })
    expect(outcome.success).toBe(true)
    if (!outcome.success) return
    expect(outcome.result.verification.status).toBe('uncertain')
    expect(outcome.result.effectiveCore).toEqual(outcome.result.rawCore)
    expect(outcome.result.effectiveCore.complement?.text).toBe('emphasizing its advantages')
  })

  it('technical failure (malformed verifier output even after repair): safe uncertain state, rawCore untouched', async () => {
    const provider = new RoutingProvider(JSON.stringify(SVOC_ANALYSIS), 'not valid json')
    const outcome = await analyzeSentenceWithComplementVerification({ provider, model: 'test-model', sentence: SENTENCE, temperature: 0.1 })
    expect(outcome.success).toBe(true)
    if (!outcome.success) return
    expect(outcome.result.verification.status).toBe('uncertain')
    expect(outcome.result.verification.classification).toBeNull()
    expect(outcome.result.effectiveCore).toEqual(outcome.result.rawCore)
  })
})

describe('analyzeSentenceWithComplementVerification — pipeline call-count contract', () => {
  it('normal SVO sentence: gate never fires, focused verifier call = 0', async () => {
    const provider = new RoutingProvider(JSON.stringify(SVO_ANALYSIS), null)
    const outcome = await analyzeSentenceWithComplementVerification({ provider, model: 'test-model', sentence: SENTENCE, temperature: 0.1 })
    expect(outcome.success).toBe(true)
    if (!outcome.success) return
    expect(outcome.result.verification.status).toBe('not_applicable')
    expect(provider.focusedVerifierCalls).toBe(0)
  })

  it('true SVOC (no comma): gate never fires, focused verifier call = 0', async () => {
    const provider = new RoutingProvider(JSON.stringify(NO_COMMA_ANALYSIS), null)
    const outcome = await analyzeSentenceWithComplementVerification({
      provider,
      model: 'test-model',
      sentence: NO_COMMA_SENTENCE,
      temperature: 0.1,
    })
    expect(outcome.success).toBe(true)
    if (!outcome.success) return
    expect(outcome.result.verification.status).toBe('not_applicable')
    expect(provider.focusedVerifierCalls).toBe(0)
  })

  it('target-shaped suspicious SVOC: exactly 1 focused verifier call, effective SVO', async () => {
    const provider = new RoutingProvider(JSON.stringify(SVOC_ANALYSIS), focusedResponse('SUPPLEMENTARY_ING', 'COMMA_SUPPLEMENT'))
    const outcome = await analyzeSentenceWithComplementVerification({ provider, model: 'test-model', sentence: SENTENCE, temperature: 0.1 })
    expect(outcome.success).toBe(true)
    if (!outcome.success) return
    expect(provider.focusedVerifierCalls).toBe(1)
    expect(outcome.result.effectiveCore.pattern).toBe('SVO')
  })

  it('calls onPhaseChange with verifyingComplement only when the gate fires', async () => {
    const phases: string[] = []
    const provider = new RoutingProvider(JSON.stringify(SVOC_ANALYSIS), focusedResponse('SUPPLEMENTARY_ING', 'COMMA_SUPPLEMENT'))
    await analyzeSentenceWithComplementVerification({
      provider,
      model: 'test-model',
      sentence: SENTENCE,
      temperature: 0.1,
      onPhaseChange: (phase) => phases.push(phase),
    })
    expect(phases).toContain('verifyingComplement')
  })

  it('does not call onPhaseChange with verifyingComplement when the gate never fires', async () => {
    const phases: string[] = []
    const provider = new RoutingProvider(JSON.stringify(SVO_ANALYSIS), null)
    await analyzeSentenceWithComplementVerification({
      provider,
      model: 'test-model',
      sentence: SENTENCE,
      temperature: 0.1,
      onPhaseChange: (phase) => phases.push(phase),
    })
    expect(phases).not.toContain('verifyingComplement')
  })
})

// Prototype 2.3L item 42/43 — Focused Subject-Verb Repair + Focused Complement Verifier
// interaction: strict ordering (S/V repair always runs first, before the comma-ing gate
// ever inspects the core) and no unnecessary double-repair.

const OVERLAP_SENTENCE = 'We found the sensor operating normally.'
const OVERLAP_ANALYSIS = singleCoreAnalysis({
    subject: { text: 'We found the sensor', start: 0, end: 20 }, // overscoped -> SUBJECT_VERB_OVERLAP
    subjectHead: null,
    verb: { text: 'found', start: 3, end: 8 },
    indirectObject: null,
    object: { text: 'the sensor', start: 9, end: 19 },
    complement: { text: 'operating normally', start: 20, end: 39 },
  })
const FOCUSED_SV_RESPONSE = JSON.stringify({ subject: 'We', subjectHead: 'We', verb: 'found' })

describe('analyzeSentenceWithComplementVerification — Focused S/V + Focused Complement ordering (item 31/42)', () => {
  it('item 42: after Focused S/V repair, a clean (no-comma) O/C never triggers the complement gate — 0 double calls', async () => {
    const provider = new RoutingProvider(JSON.stringify(OVERLAP_ANALYSIS), null, FOCUSED_SV_RESPONSE)
    const outcome = await analyzeSentenceWithComplementVerification({
      provider,
      model: 'test-model',
      sentence: OVERLAP_SENTENCE,
      temperature: 0.1,
    })
    expect(outcome.success).toBe(true)
    if (!outcome.success) return
    expect(provider.focusedSvCalls).toBe(1)
    expect(provider.focusedVerifierCalls).toBe(0)
    expect(outcome.result.coreRepair).toEqual({ failureReason: 'SUBJECT_VERB_OVERLAP', strategy: 'focused-sv', status: 'repaired' })
    expect(outcome.result.verification.status).toBe('not_applicable')
    expect(outcome.result.effectiveCore.subject?.text).toBe('We')
    expect(outcome.result.effectiveCore.verb?.text).toBe('found')
    expect(outcome.result.effectiveCore.object?.text).toBe('the sensor')
    expect(outcome.result.effectiveCore.complement?.text).toBe('operating normally')
    expect(outcome.result.effectiveCore.pattern).toBe('SVOC')
  })

  it('item 33/43: the original 2.3I target (short subject, no overlap) never triggers Focused S/V — call 0 — while the complement gate still fires normally', async () => {
    const provider = new RoutingProvider(JSON.stringify(SVOC_ANALYSIS), focusedResponse('SUPPLEMENTARY_ING', 'COMMA_SUPPLEMENT'))
    const outcome = await analyzeSentenceWithComplementVerification({
      provider,
      model: 'test-model',
      sentence: SENTENCE,
      temperature: 0.1,
    })
    expect(outcome.success).toBe(true)
    if (!outcome.success) return
    expect(provider.focusedSvCalls).toBe(0)
    expect(provider.focusedVerifierCalls).toBe(1)
    expect(outcome.result.coreRepair).toEqual({ failureReason: 'NONE', strategy: 'none', status: 'not-needed' })
    expect(outcome.result.verification.status).toBe('confirmed_supplementary_ing')
    expect(outcome.result.effectiveCore.pattern).toBe('SVO')
  })
})

// Prototype 2.5W — Focused Copular Core Repair integration tests.

const COPULAR_SENTENCE = 'The parameter C is a function of the regression slope.'
const COPULAR_ANALYSIS = singleCoreAnalysis({
    subject: { text: 'The parameter C', start: 0, end: 16 },
    subjectHead: { text: 'parameter C', start: 4, end: 16 },
    verb: { text: 'is', start: 17, end: 19 },
    indirectObject: null,
    object: { text: 'a function of the regression slope', start: 20, end: 55 },
    complement: null,
  })
const COPULAR_RESPONSE = JSON.stringify({ subject: 'The parameter C', verb: 'is', complement: 'a function of the regression slope' })

const PASSIVE_SENTENCE = 'The method is applied to the data.'
const PASSIVE_ANALYSIS = singleCoreAnalysis({
    subject: { text: 'The method', start: 0, end: 10 },
    subjectHead: { text: 'The method', start: 0, end: 10 },
    verb: { text: 'is applied', start: 11, end: 21 },
    indirectObject: null,
    object: null,
    complement: null,
  })

describe('analyzeSentenceWithComplementVerification — Prototype 2.5W copular gate integration', () => {
  it('canonical formation normalizes bare-be O-vs-C to SVC without a focused call', async () => {
    const provider = new RoutingProvider(JSON.stringify(COPULAR_ANALYSIS), null, null, COPULAR_RESPONSE)
    const outcome = await analyzeSentenceWithComplementVerification({
      provider,
      model: 'test-model',
      sentence: COPULAR_SENTENCE,
      temperature: 0.1,
    })
    expect(outcome.success).toBe(true)
    if (!outcome.success) return
    expect(provider.focusedCopularCalls).toBe(0)
    expect(provider.focusedVerifierCalls).toBe(0)
    expect(outcome.result.copularRepair.status).toBe('not_applicable')
    expect(outcome.result.effectiveCore.pattern).toBe('SVC')
    expect(outcome.result.effectiveCore.verb?.text).toBe('is')
    expect(outcome.result.effectiveCore.complement?.text).toBe('a function of the regression slope')
    expect(outcome.result.effectiveCore.object).toBeNull()
    expect(outcome.result.effectiveCore.indirectObject).toBeNull()
    expect(outcome.result.rawCore.pattern).toBe('SVC')
    expect(outcome.result.rawCore.complement?.text).toBe('a function of the regression slope')
    expect(outcome.result.analysis.sentenceCore.pattern).toBe('SVC')
  })

  it('does NOT fire the copular gate for a passive sentence — 0 focused copular calls', async () => {
    const provider = new RoutingProvider(JSON.stringify(PASSIVE_ANALYSIS), null, null, null)
    const outcome = await analyzeSentenceWithComplementVerification({
      provider,
      model: 'test-model',
      sentence: PASSIVE_SENTENCE,
      temperature: 0.1,
    })
    expect(outcome.success).toBe(true)
    if (!outcome.success) return
    expect(provider.focusedCopularCalls).toBe(0)
    expect(outcome.result.copularRepair.status).toBe('not_applicable')
    expect(outcome.result.effectiveCore).toEqual(outcome.result.rawCore)
  })

  it('does not invoke a now-redundant focused copular repair response', async () => {
    const provider = new RoutingProvider(JSON.stringify(COPULAR_ANALYSIS), null, null, 'not valid json')
    const outcome = await analyzeSentenceWithComplementVerification({
      provider,
      model: 'test-model',
      sentence: COPULAR_SENTENCE,
      temperature: 0.1,
    })
    expect(outcome.success).toBe(true)
    if (!outcome.success) return
    expect(provider.focusedCopularCalls).toBe(0)
    expect(outcome.result.copularRepair.status).toBe('not_applicable')
    expect(outcome.result.effectiveCore).toEqual(outcome.result.rawCore)
    expect(outcome.result.effectiveCore.pattern).toBe('SVC')
    // The comma-ing gate still runs normally afterward (never blocked by a copular failure).
    expect(outcome.result.verification.status).toBe('not_applicable')
  })

  it('a normal SVO sentence with no copula-led verb never triggers the copular gate', async () => {
    const provider = new RoutingProvider(JSON.stringify(SVO_ANALYSIS), null, null, null)
    const outcome = await analyzeSentenceWithComplementVerification({ provider, model: 'test-model', sentence: SENTENCE, temperature: 0.1 })
    expect(outcome.success).toBe(true)
    if (!outcome.success) return
    expect(provider.focusedCopularCalls).toBe(0)
    expect(outcome.result.copularRepair.status).toBe('not_applicable')
  })
})

// Prototype 2.5Z — Focused Passive-Core Overcomplement Repair integration tests.

const CASE_B_SENTENCE =
  'This regression line can be rotated to the horizontal to normalize the data using the equation [EQUATION_6] where Ln is the normalized radiance, a and b are the y-intercept and slope of the regression line, respectively, and Lavg is the average of the measured radiance data.'
const CASE_B_HUGE_COMPLEMENT =
  'to the horizontal to normalize the data using the equation [EQUATION_6] where Ln is the normalized radiance, a and b are the y-intercept and slope of the regression line, respectively, and Lavg is the average of the measured radiance data'

// A primary GrammarAnalysis response with subject=null -- triggers NULL_SUBJECT, routing to
// forced-core recovery (the exact live CASE B failure path per Prototype 2.5Y).
const NULL_SUBJECT_ANALYSIS = singleCoreAnalysis(
  { subject: null, subjectHead: null, verb: null, indirectObject: null, object: null, complement: null })

// The forced-core recovery's own malformed response -- exactly the 2.5Y-confirmed shape
// (huge complement swallowing everything after the passive verb).
const FORCED_CORE_MALFORMED_RESPONSE = JSON.stringify({
  subject: { text: 'This regression line', start: 0, end: 21 },
  subjectHead: { text: 'regression line', start: 5, end: 21 },
  predicateCores: [{
    connector: null,
    verb: { text: 'can be rotated', start: 21, end: 35 },
    indirectObject: null,
    object: null,
    complement: { text: CASE_B_HUGE_COMPLEMENT, start: 36, end: 274 },
  }],
})

const PASSIVE_REPAIR_SV_RESPONSE = JSON.stringify({ pattern: 'SV', complement: null })

// A primary GrammarAnalysis response that itself (no forced-core needed) produces the
// malformed SVOC/suspicious-complement shape -- the "passive+infinitive" failure family
// confirmed in Prototype 2.5Y (3/5 runs handled entirely by the primary call).
const PRIMARY_MALFORMED_ANALYSIS = singleCoreAnalysis({
    subject: { text: 'This regression line', start: 0, end: 21 },
    subjectHead: { text: 'regression line', start: 5, end: 21 },
    verb: { text: 'can be rotated', start: 21, end: 35 },
    indirectObject: null,
    object: { text: 'the horizontal', start: 39, end: 53 },
    complement: { text: 'to normalize the data', start: 54, end: 75 },
  })
const PRIMARY_MALFORMED_SENTENCE = 'This regression line can be rotated to the horizontal to normalize the data.'

// Already-correct raw core (the 1/10 shape 2.5Y also observed) -- gate must not fire at all.
const ALREADY_CORRECT_SV_ANALYSIS = singleCoreAnalysis({
    subject: { text: 'This regression line', start: 0, end: 21 },
    subjectHead: { text: 'regression line', start: 5, end: 21 },
    verb: { text: 'can be rotated', start: 21, end: 35 },
    indirectObject: null,
    object: null,
    complement: null,
  })

describe('analyzeSentenceWithComplementVerification — Prototype 2.5Z passive-core gate integration', () => {
  it('item 31: canonical forced-core normalization removes a passive PP before focused repair', async () => {
    const provider = new RoutingProvider(
      JSON.stringify(NULL_SUBJECT_ANALYSIS),
      null,
      null,
      null,
      FORCED_CORE_MALFORMED_RESPONSE,
      PASSIVE_REPAIR_SV_RESPONSE,
    )
    const outcome = await analyzeSentenceWithComplementVerification({
      provider,
      model: 'test-model',
      sentence: CASE_B_SENTENCE,
      temperature: 0.1,
    })
    expect(outcome.success).toBe(true)
    if (!outcome.success) return
    expect(provider.forcedCoreCalls).toBe(1)
    expect(provider.focusedPassiveCalls).toBe(0)
    expect(provider.focusedCopularCalls).toBe(0)
    expect(outcome.result.passiveRepair.status).toBe('not_applicable')
    expect(outcome.result.effectiveCore.pattern).toBe('SV')
    expect(outcome.result.effectiveCore.verb?.text).toBe('can be rotated')
    expect(outcome.result.effectiveCore.complement).toBeNull()
    expect(outcome.result.effectiveCore.object).toBeNull()
    expect(outcome.result.rawCore.pattern).toBe('SV')
    expect(outcome.result.rawCore.complement).toBeNull()
  })

  it('item 32: canonical normalization removes the PP complement but preserves a non-prefixed O candidate', async () => {
    const provider = new RoutingProvider(JSON.stringify(PRIMARY_MALFORMED_ANALYSIS), null, null, null, null, PASSIVE_REPAIR_SV_RESPONSE)
    const outcome = await analyzeSentenceWithComplementVerification({
      provider,
      model: 'test-model',
      sentence: PRIMARY_MALFORMED_SENTENCE,
      temperature: 0.1,
    })
    expect(outcome.success).toBe(true)
    if (!outcome.success) return
    expect(provider.forcedCoreCalls).toBe(0)
    expect(provider.focusedPassiveCalls).toBe(0)
    expect(outcome.result.passiveRepair.status).toBe('not_applicable')
    expect(outcome.result.effectiveCore.pattern).toBe('SVO')
    expect(outcome.result.effectiveCore.object?.text).toBe('the horizontal')
    expect(outcome.result.effectiveCore.complement).toBeNull()
  })

  it('item 33: already-correct raw SV core never invokes the focused passive repair (0 calls)', async () => {
    const provider = new RoutingProvider(JSON.stringify(ALREADY_CORRECT_SV_ANALYSIS), null, null, null, null, null)
    const outcome = await analyzeSentenceWithComplementVerification({
      provider,
      model: 'test-model',
      sentence: PRIMARY_MALFORMED_SENTENCE,
      temperature: 0.1,
    })
    expect(outcome.success).toBe(true)
    if (!outcome.success) return
    expect(provider.focusedPassiveCalls).toBe(0)
    expect(outcome.result.passiveRepair.status).toBe('not_applicable')
    expect(outcome.result.effectiveCore).toEqual(outcome.result.rawCore)
  })

  it('item 28: canonical copular normalization invokes neither focused copular nor passive repair', async () => {
    const provider = new RoutingProvider(JSON.stringify(COPULAR_ANALYSIS), null, null, COPULAR_RESPONSE, null, null)
    const outcome = await analyzeSentenceWithComplementVerification({
      provider,
      model: 'test-model',
      sentence: COPULAR_SENTENCE,
      temperature: 0.1,
    })
    expect(outcome.success).toBe(true)
    if (!outcome.success) return
    expect(provider.focusedCopularCalls).toBe(0)
    expect(provider.focusedPassiveCalls).toBe(0)
    expect(outcome.result.copularRepair.status).toBe('not_applicable')
    expect(outcome.result.passiveRepair.status).toBe('not_applicable')
  })

  it('does not invoke a supplied focused passive failure after canonical normalization succeeds', async () => {
    const provider = new RoutingProvider(
      JSON.stringify(NULL_SUBJECT_ANALYSIS),
      null,
      null,
      null,
      FORCED_CORE_MALFORMED_RESPONSE,
      'not valid json',
    )
    const outcome = await analyzeSentenceWithComplementVerification({
      provider,
      model: 'test-model',
      sentence: CASE_B_SENTENCE,
      temperature: 0.1,
    })
    expect(outcome.success).toBe(true)
    if (!outcome.success) return
    expect(provider.focusedPassiveCalls).toBe(0)
    expect(outcome.result.passiveRepair.status).toBe('not_applicable')
    expect(outcome.result.effectiveCore).toEqual(outcome.result.rawCore)
    expect(outcome.result.effectiveCore.pattern).toBe('SV')
  })
})

import type { LLMProvider } from '../../../llm/types.ts'
import { analyzeSentenceWithAutoRecovery, type AnalyzeWithAutoRecoveryPhase, type CoreRepairMeta } from './analyzeSentenceWithAutoRecovery.ts'
import type { AnalyzeSentenceMeta } from './GrammarAnalyzer.ts'
import { isSuspiciousCommaIngComplement } from './commaIngComplementGate.ts'
import { getFocusedComplementVerification } from './focusedComplementVerifierService.ts'
import { evaluateCopularGate } from './copularCoreGate.ts'
import { getFocusedCopularCoreRepair } from './focusedCopularCoreRepairService.ts'
import { evaluatePassiveCoreGate } from './passiveCoreGate.ts'
import { getFocusedPassiveCoreRepair } from './focusedPassiveCoreRepairService.ts'
import { attachDerivedPattern } from './derivePattern.ts'
import type { FocusedClassification, FocusedReasonCode } from '../schemas/focusedComplementVerification.schema.ts'
import type { GrammarAnalysis, LlmSentenceCore, SentenceCore } from '../schemas/grammarAnalysis.schema.ts'

export type AnalyzeWithComplementVerificationPhase = AnalyzeWithAutoRecoveryPhase | 'verifyingComplement'

export type ComplementVerificationStatus =
  /** The suspicious gate never fired — either the core isn't SVOC-shaped, or it is but
   * doesn't match the comma+V-ing surface pattern at all. The overwhelming majority of
   * sentences land here, with zero extra LLM calls. */
  | 'not_applicable'
  /** Gate fired; the focused verifier confirmed the candidate complement genuinely
   * predicates the object — core is left exactly as GrammarAnalysis produced it. */
  | 'confirmed_object_complement'
  /** Gate fired; the focused verifier confirmed the candidate complement is a
   * comma-attached supplementary -ing addition, not a real SVOC complement —
   * effectiveCore has complement nulled and pattern re-derived. */
  | 'confirmed_supplementary_ing'
  /** Gate fired, but the focused verifier returned UNCERTAIN or failed technically
   * (malformed output even after one repair). effectiveCore is left equal to rawCore
   * (never guess), but the UI must not present it with full confidence — see item 18. */
  | 'uncertain'

export interface ComplementVerification {
  status: ComplementVerificationStatus
  classification: FocusedClassification | null
  reasonCode: FocusedReasonCode | null
}

export type CopularCoreRepairStatus =
  /** copularCoreGate.ts never fired — the overwhelming majority of sentences land here,
   * with zero extra LLM calls. */
  | 'not_applicable'
  /** Gate fired and the focused repair succeeded — effectiveCore's subject/verb/complement
   * come from FocusedCopularCoreRepairer, object/indirectObject nulled, pattern re-derived
   * as SVC. */
  | 'repaired'
  /** Gate fired but the focused repair failed technically (malformed output even after one
   * repair attempt, or ungroundable/nonsensical result) — effectiveCore falls back to
   * rawCore untouched (never guess). */
  | 'failed'

export interface CopularCoreRepairMeta {
  status: CopularCoreRepairStatus
}

export type PassiveCoreRepairStatus =
  /** passiveCoreGate.ts never fired — the overwhelming majority of sentences land here,
   * with zero extra LLM calls. */
  | 'not_applicable'
  /** Gate fired and the focused repair succeeded — effectiveCore's pattern/complement come
   * from FocusedPassiveCoreRepairer (SV: complement nulled; SVC: the genuine complement
   * kept), object/indirectObject nulled either way. */
  | 'repaired'
  /** Gate fired but the focused repair failed technically — effectiveCore falls back to
   * rawCore untouched (never guess). */
  | 'failed'

export interface PassiveCoreRepairMeta {
  status: PassiveCoreRepairStatus
}

export interface VerifiedSentenceAnalysis {
  /** Raw GrammarAnalysis result, completely immutable — never mutated by this module.
   * Kept for debug/meta display (item 13: raw analysis stays visible in debug details). */
  analysis: GrammarAnalysis
  meta: AnalyzeSentenceMeta
  /** Convenience alias for analysis.sentenceCore — the core exactly as
   * analyzeSentenceWithAutoRecovery produced it (post forced-core recovery if that ran),
   * BEFORE complement verification. Never mutated. */
  rawCore: SentenceCore
  /** The core every downstream consumer (basic-core display, pattern display,
   * PredicateStructure/ReadingGuide cache keys, hybrid merger, structure tree) MUST use
   * (Prototype 2.3I item 20) — identical to rawCore except when `verification.status ===
   * 'confirmed_supplementary_ing'`, in which case `complement` is null and `pattern` is
   * re-derived via derivePattern.ts (never hand-set to a literal "SVO"). */
  effectiveCore: SentenceCore
  verification: ComplementVerification
  /** Prototype 2.3L — which core-repair strategy (if any) ran and why, kept for debug
   * display alongside `verification`. Raw authority preservation: this never affects
   * `analysis`/`rawCore` (both already reflect whatever strategy ran, exactly as
   * analyzeSentenceWithAutoRecovery.ts produced them) — it is purely informational. */
  coreRepair: CoreRepairMeta
  /** Prototype 2.5W — whether the focused copular core repair (copularCoreGate.ts +
   * FocusedCopularCoreRepairer.ts) ran and why, kept for debug display alongside
   * `verification`/`coreRepair`. Purely informational, same philosophy as `coreRepair`. */
  copularRepair: CopularCoreRepairMeta
  /** Prototype 2.5Z — whether the focused passive-core overcomplement repair
   * (passiveCoreGate.ts + FocusedPassiveCoreRepairer.ts) ran and why, kept for debug display
   * alongside `verification`/`coreRepair`/`copularRepair`. Purely informational. */
  passiveRepair: PassiveCoreRepairMeta
}

export type AnalyzeWithComplementVerificationOutcome =
  | { success: true; result: VerifiedSentenceAnalysis; recoveryUsed: boolean }
  | { success: false; error: string }

export interface AnalyzeSentenceWithComplementVerificationOptions {
  provider: LLMProvider
  model: string
  sentence: string
  temperature: number
  onPhaseChange?: (phase: AnalyzeWithComplementVerificationPhase) => void
}

const NOT_APPLICABLE: ComplementVerification = { status: 'not_applicable', classification: null, reasonCode: null }
const COPULAR_NOT_APPLICABLE: CopularCoreRepairMeta = { status: 'not_applicable' }
const PASSIVE_NOT_APPLICABLE: PassiveCoreRepairMeta = { status: 'not_applicable' }

/**
 * Prototype 2.3I — layers focused complement verification ON TOP OF the existing, UNCHANGED
 * analyzeSentenceWithAutoRecovery() (Prototype 2.2's GrammarAnalysis + forced-core recovery
 * pipeline) rather than modifying it. This is the ONLY new call site App.tsx should use for
 * "骨格を見る" going forward.
 *
 * Pipeline: analyzeSentenceWithAutoRecovery (unchanged) -> Prototype 2.5W copular-core gate
 * (copularCoreGate.ts, trigger-only) -> IF triggered, the focused copular core repair
 * (FocusedCopularCoreRepairer.ts) -> IF that did NOT apply, Prototype 2.5Z passive-core
 * overcomplement gate (passiveCoreGate.ts, trigger-only) -> IF triggered, the focused
 * passive-core repair (FocusedPassiveCoreRepairer.ts) -> IF that did NOT apply either, the
 * suspicious comma+V-ing gate (commaIngComplementGate.ts, trigger-only, never rewrites a
 * core) -> IF triggered, the focused complement verifier (FocusedComplementVerifier.ts via
 * focusedComplementVerifierService.ts's cache) -> effectiveCore derivation. All four gates
 * are deliberately separate mechanisms serving different purposes (item 10 of the 2.3I
 * order, extended by 2.5W item 6 and 2.5Z item 7) — this function never mixes their logic.
 * The copular and passive gates are mutually exclusive by construction (see
 * passiveCoreGate.ts's own doc comment: copularCoreGate's BARE_COPULA regex never matches a
 * modal-led verb, and its multi-word branch explicitly excludes passive-looking verbs) and
 * checked in that order purely because copularCoreGate is the more specific/older-validated
 * of the two; neither overlaps the comma-ing gate's own SVOC-with-comma-ing precondition —
 * in practice at most one of the three repair gates ever fires for a given sentence.
 *
 * The suspicious comma-ing gate's own condition already guarantees subject/verb/object are
 * non-null when it returns true (SVOC pattern requires all three), so `rawCore.subject`/
 * `.verb`/`.object`/`.complement` are safe to pass to the verifier without further null
 * checks.
 */
export async function analyzeSentenceWithComplementVerification(
  options: AnalyzeSentenceWithComplementVerificationOptions,
): Promise<AnalyzeWithComplementVerificationOutcome> {
  const { provider, model, sentence, temperature, onPhaseChange } = options

  const outcome = await analyzeSentenceWithAutoRecovery({ provider, model, sentence, temperature, onPhaseChange })
  if (!outcome.success) return outcome

  const { analysis, meta } = outcome.result
  const rawCore = analysis.sentenceCore

  // Prototype 2.5W Part A — copular-core gate, checked first (item 6/20: Stage 1 remains
  // the primary single-core summary; a coordinated second predicate stays Stage 2's job,
  // never pulled into this core). `stage2MainPredicate` is always null in production today
  // — see copularCoreGate.ts's own doc comment for why signal 2 is validated-but-deferred.
  const copularGate = evaluateCopularGate(rawCore.verb, rawCore.object, null)
  if (copularGate.fire) {
    const copularRepair = await getFocusedCopularCoreRepair({
      provider,
      model,
      temperature,
      originalText: analysis.normalizedText,
      stage2Hint: null,
    })
    if (copularRepair.success) {
      const effectiveCoreRaw: LlmSentenceCore = {
        subject: copularRepair.result.subject,
        subjectHead: rawCore.subjectHead,
        verb: copularRepair.result.verb,
        indirectObject: null,
        object: null,
        complement: copularRepair.result.complement,
      }
      return {
        success: true,
        recoveryUsed: outcome.recoveryUsed,
        result: {
          analysis,
          meta,
          rawCore,
          effectiveCore: attachDerivedPattern(effectiveCoreRaw),
          verification: NOT_APPLICABLE,
          coreRepair: outcome.coreRepair,
          copularRepair: { status: 'repaired' },
          passiveRepair: PASSIVE_NOT_APPLICABLE,
        },
      }
    }
    // Technical failure — fall through to rawCore, same safe-failure philosophy as every
    // other focused repair in this file (never guess, never surface a technical error).
    return continueAfterCoreGates(analysis, meta, rawCore, outcome, { status: 'failed' }, PASSIVE_NOT_APPLICABLE, provider, model, temperature, onPhaseChange)
  }

  // Prototype 2.5Z Part A — passive-core overcomplement gate, checked only when the copular
  // gate did not fire (item 7: mutually exclusive by verb shape — see passiveCoreGate.ts).
  const passiveGate = evaluatePassiveCoreGate(rawCore.verb, rawCore.pattern, rawCore.complement)
  if (passiveGate.fire) {
    const passiveRepair = await getFocusedPassiveCoreRepair({
      provider,
      model,
      temperature,
      originalText: analysis.normalizedText,
      verb: rawCore.verb!,
      pattern: rawCore.pattern,
      object: rawCore.object,
      indirectObject: rawCore.indirectObject,
      complement: rawCore.complement,
    })
    if (passiveRepair.success) {
      const effectiveCoreRaw: LlmSentenceCore = {
        subject: rawCore.subject,
        subjectHead: rawCore.subjectHead,
        verb: rawCore.verb,
        indirectObject: null,
        object: null,
        complement: passiveRepair.result.pattern === 'SVC' ? passiveRepair.result.complement : null,
      }
      return {
        success: true,
        recoveryUsed: outcome.recoveryUsed,
        result: {
          analysis,
          meta,
          rawCore,
          effectiveCore: attachDerivedPattern(effectiveCoreRaw),
          verification: NOT_APPLICABLE,
          coreRepair: outcome.coreRepair,
          copularRepair: COPULAR_NOT_APPLICABLE,
          passiveRepair: { status: 'repaired' },
        },
      }
    }
    return continueAfterCoreGates(analysis, meta, rawCore, outcome, COPULAR_NOT_APPLICABLE, { status: 'failed' }, provider, model, temperature, onPhaseChange)
  }

  return continueAfterCoreGates(analysis, meta, rawCore, outcome, COPULAR_NOT_APPLICABLE, PASSIVE_NOT_APPLICABLE, provider, model, temperature, onPhaseChange)
}

async function continueAfterCoreGates(
  analysis: GrammarAnalysis,
  meta: AnalyzeSentenceMeta,
  rawCore: SentenceCore,
  outcome: { recoveryUsed: boolean; coreRepair: CoreRepairMeta },
  copularRepair: CopularCoreRepairMeta,
  passiveRepair: PassiveCoreRepairMeta,
  provider: LLMProvider,
  model: string,
  temperature: number,
  onPhaseChange: ((phase: AnalyzeWithComplementVerificationPhase) => void) | undefined,
): Promise<AnalyzeWithComplementVerificationOutcome> {
  if (!isSuspiciousCommaIngComplement(analysis.normalizedText, rawCore)) {
    return {
      success: true,
      recoveryUsed: outcome.recoveryUsed,
      result: { analysis, meta, rawCore, effectiveCore: rawCore, verification: NOT_APPLICABLE, coreRepair: outcome.coreRepair, copularRepair, passiveRepair },
    }
  }

  onPhaseChange?.('verifyingComplement')
  const verification = await getFocusedComplementVerification({
    provider,
    model,
    temperature,
    originalText: analysis.normalizedText,
    // Non-null per the gate's own condition (pattern === 'SVOC' requires object/complement
    // present; subject/verb are guaranteed by isSentenceCoreFailure already having passed).
    subject: rawCore.subject!,
    verb: rawCore.verb!,
    indirectObject: rawCore.indirectObject,
    object: rawCore.object!,
    complement: rawCore.complement!,
  })

  if (!verification.success) {
    return {
      success: true,
      recoveryUsed: outcome.recoveryUsed,
      result: {
        analysis,
        meta,
        rawCore,
        effectiveCore: rawCore,
        verification: { status: 'uncertain', classification: null, reasonCode: null },
        coreRepair: outcome.coreRepair,
        copularRepair,
        passiveRepair,
      },
    }
  }

  if (verification.classification === 'SUPPLEMENTARY_ING') {
    const effectiveCoreRaw: LlmSentenceCore = {
      subject: rawCore.subject,
      subjectHead: rawCore.subjectHead,
      verb: rawCore.verb,
      indirectObject: rawCore.indirectObject,
      object: rawCore.object,
      complement: null,
    }
    return {
      success: true,
      recoveryUsed: outcome.recoveryUsed,
      result: {
        analysis,
        meta,
        rawCore,
        effectiveCore: attachDerivedPattern(effectiveCoreRaw),
        verification: {
          status: 'confirmed_supplementary_ing',
          classification: verification.classification,
          reasonCode: verification.reasonCode,
        },
        coreRepair: outcome.coreRepair,
        copularRepair,
        passiveRepair,
      },
    }
  }

  const status: ComplementVerificationStatus =
    verification.classification === 'OBJECT_COMPLEMENT' ? 'confirmed_object_complement' : 'uncertain'
  return {
    success: true,
    recoveryUsed: outcome.recoveryUsed,
    result: {
      analysis,
      meta,
      rawCore,
      effectiveCore: rawCore,
      verification: { status, classification: verification.classification, reasonCode: verification.reasonCode },
      coreRepair: outcome.coreRepair,
      copularRepair,
      passiveRepair,
    },
  }
}

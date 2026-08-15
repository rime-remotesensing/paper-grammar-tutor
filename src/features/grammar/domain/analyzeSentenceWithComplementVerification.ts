import type { LLMProvider } from '../../../llm/types.ts'
import { analyzeSentenceWithAutoRecovery, type AnalyzeWithAutoRecoveryPhase, type CoreRepairMeta } from './analyzeSentenceWithAutoRecovery.ts'
import type { AnalyzeSentenceMeta } from './GrammarAnalyzer.ts'
import { isSuspiciousCommaIngComplement } from './commaIngComplementGate.ts'
import { getFocusedComplementVerification } from './focusedComplementVerifierService.ts'
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

/**
 * Prototype 2.3I — layers focused complement verification ON TOP OF the existing, UNCHANGED
 * analyzeSentenceWithAutoRecovery() (Prototype 2.2's GrammarAnalysis + forced-core recovery
 * pipeline) rather than modifying it. This is the ONLY new call site App.tsx should use for
 * "骨格を見る" going forward.
 *
 * Pipeline: analyzeSentenceWithAutoRecovery (unchanged) -> suspicious comma+V-ing gate
 * (commaIngComplementGate.ts, trigger-only, never rewrites a core) -> IF triggered, the
 * focused complement verifier (FocusedComplementVerifier.ts via
 * focusedComplementVerifierService.ts's cache) -> effectiveCore derivation. The gate and
 * the existing forced-core recovery are deliberately separate mechanisms serving different
 * purposes (item 10) — this function never mixes their logic.
 *
 * The suspicious gate's own condition already guarantees subject/verb/object are non-null
 * when it returns true (SVOC pattern requires all three), so `rawCore.subject`/`.verb`/
 * `.object`/`.complement` are safe to pass to the verifier without further null checks.
 */
export async function analyzeSentenceWithComplementVerification(
  options: AnalyzeSentenceWithComplementVerificationOptions,
): Promise<AnalyzeWithComplementVerificationOutcome> {
  const { provider, model, sentence, temperature, onPhaseChange } = options

  const outcome = await analyzeSentenceWithAutoRecovery({ provider, model, sentence, temperature, onPhaseChange })
  if (!outcome.success) return outcome

  const { analysis, meta } = outcome.result
  const rawCore = analysis.sentenceCore

  if (!isSuspiciousCommaIngComplement(analysis.normalizedText, rawCore)) {
    return {
      success: true,
      recoveryUsed: outcome.recoveryUsed,
      result: { analysis, meta, rawCore, effectiveCore: rawCore, verification: NOT_APPLICABLE, coreRepair: outcome.coreRepair },
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
    },
  }
}

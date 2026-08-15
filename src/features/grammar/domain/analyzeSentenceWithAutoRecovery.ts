import type { LLMProvider } from '../../../llm/types.ts'
import { analyzeSentence, type AnalyzeSentenceResult } from './GrammarAnalyzer.ts'
import { mergeRecoveredSentenceCore, recoverSentenceCore } from './sentenceCoreRecovery.ts'
import { classifySentenceCoreFailure, type SentenceCoreFailureReason } from './sentenceCoreFailureReason.ts'
import { getFocusedSubjectVerbRepair } from './focusedSubjectVerbRepairService.ts'
import { mergeFocusedSubjectVerbRepair } from './mergeFocusedSubjectVerbRepair.ts'

export type AnalyzeWithAutoRecoveryPhase = 'analyzing' | 'confirmingCore' | 'repairingSubjectVerb'

export type CoreRepairStrategy = 'none' | 'forced-core' | 'focused-sv'

export interface CoreRepairMeta {
  failureReason: SentenceCoreFailureReason
  strategy: CoreRepairStrategy
  status: 'not-needed' | 'repaired'
}

export type AnalyzeWithAutoRecoveryOutcome =
  | { success: true; result: AnalyzeSentenceResult; recoveryUsed: boolean; coreRepair: CoreRepairMeta }
  | { success: false; error: string }

export interface AnalyzeSentenceWithAutoRecoveryOptions {
  provider: LLMProvider
  model: string
  sentence: string
  temperature: number
  /** Called right before each underlying LLM call starts, so the caller can show a
   * phase-appropriate loading message without needing its own copy of this orchestration
   * logic. */
  onPhaseChange?: (phase: AnalyzeWithAutoRecoveryPhase) => void
}

/**
 * Prototype 2.2: what used to be a user-triggered second click was made fully automatic
 * and internal to "骨格を見る" — the user only ever presses one button. This file calls the
 * SAME, unmodified analyzeSentence() (GrammarAnalysis, prompt/schema untouched).
 *
 * Prototype 2.3L: recovery is no longer a single blanket strategy gated on one boolean —
 * sentenceCoreFailureReason.ts's classifySentenceCoreFailure() determines WHY the core is
 * unusable, and each reason routes to the repair mechanism validated for that exact shape
 * (Prototype 2.3G/H/J/K):
 *   - NONE                 -> no repair call at all (zero extra latency, the overwhelming
 *                              majority of sentences land here).
 *   - SUBJECT_VERB_OVERLAP  -> Focused Subject-Verb Repair (FocusedSubjectVerbRepairer.ts).
 *                              Existing forced-core recovery was measured structurally
 *                              unsuited to this exact shape (0/30 correct on the primary
 *                              target "We found the sensor operating normally."); Focused
 *                              S/V Repair reached 61/61 correct on every actual routed case
 *                              found across target + controls + a natural-overlap corpus
 *                              (Prototype 2.3K). It NEVER regenerates indirectObject/
 *                              object/complement itself — those are preserved from the raw
 *                              core only when mechanically safe (see
 *                              mergeFocusedSubjectVerbRepair.ts), never guessed.
 *   - everything else       -> the existing, UNCHANGED forced-core recovery
 *                              (recoverSentenceCore/mergeRecoveredSentenceCore) — still the
 *                              validated path for NULL_SUBJECT/NULL_VERB/
 *                              SUBJECT_HEAD_OUTSIDE since Prototype 2.2.
 * A Focused Subject-Verb Repair technical failure does NOT cascade to forced-core (that
 * path was already measured unsuited to this failure shape) — it fails the exact same safe
 * way forced-core failure always has, rather than risk asserting a wrong core.
 */
export async function analyzeSentenceWithAutoRecovery(
  options: AnalyzeSentenceWithAutoRecoveryOptions,
): Promise<AnalyzeWithAutoRecoveryOutcome> {
  const { provider, model, sentence, temperature, onPhaseChange } = options

  onPhaseChange?.('analyzing')
  const grammarResult = await analyzeSentence({ provider, model, sentence, temperature })
  const failureReason = classifySentenceCoreFailure(grammarResult.analysis.sentenceCore)

  if (failureReason === 'NONE') {
    return {
      success: true,
      result: grammarResult,
      recoveryUsed: false,
      coreRepair: { failureReason, strategy: 'none', status: 'not-needed' },
    }
  }

  if (failureReason === 'SUBJECT_VERB_OVERLAP') {
    onPhaseChange?.('repairingSubjectVerb')
    const rawCore = grammarResult.analysis.sentenceCore
    let focused: Awaited<ReturnType<typeof getFocusedSubjectVerbRepair>>
    try {
      focused = await getFocusedSubjectVerbRepair({
        provider,
        model,
        temperature,
        originalText: grammarResult.analysis.normalizedText,
        rawSubject: rawCore.subject,
        rawSubjectHead: rawCore.subjectHead,
        rawVerb: rawCore.verb,
      })
    } catch {
      return { success: false, error: '文の骨格を確定できませんでした。' }
    }

    if (!focused.success) {
      return { success: false, error: '文の骨格を確定できませんでした。' }
    }

    const { core: repairedCore } = mergeFocusedSubjectVerbRepair(rawCore, focused.result)
    const mergedAnalysis = { ...grammarResult.analysis, sentenceCore: repairedCore }
    return {
      success: true,
      result: { analysis: mergedAnalysis, meta: grammarResult.meta },
      recoveryUsed: true,
      coreRepair: { failureReason, strategy: 'focused-sv', status: 'repaired' },
    }
  }

  onPhaseChange?.('confirmingCore')
  let recovered: Awaited<ReturnType<typeof recoverSentenceCore>>
  try {
    recovered = await recoverSentenceCore({
      provider,
      model,
      sentence: grammarResult.analysis.normalizedText,
      temperature,
    })
  } catch {
    return { success: false, error: '文の骨格を確定できませんでした。' }
  }

  if (!recovered.success) {
    return { success: false, error: '文の骨格を確定できませんでした。' }
  }

  const mergedAnalysis = mergeRecoveredSentenceCore(grammarResult.analysis, recovered.sentenceCore)
  return {
    success: true,
    result: { analysis: mergedAnalysis, meta: grammarResult.meta },
    recoveryUsed: true,
    coreRepair: { failureReason, strategy: 'forced-core', status: 'repaired' },
  }
}

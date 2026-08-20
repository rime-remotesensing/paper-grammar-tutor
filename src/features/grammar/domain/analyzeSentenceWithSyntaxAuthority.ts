import {
  analyzeSentenceWithComplementVerification,
  type AnalyzeSentenceWithComplementVerificationOptions,
  type AnalyzeWithComplementVerificationOutcome,
  type VerifiedSentenceAnalysis,
} from './analyzeSentenceWithComplementVerification.ts'
import { analyzeSyntaxAuthority } from './analyzeSyntaxAuthority.ts'
import { projectPrimaryCore } from './sentenceCoreSet.ts'
import type { StanzaToken } from './stanzaSyntaxAuthority.ts'

/**
 * Prototype 2.6G1 -- the ONLY new call site App.tsx/AnalysisResultPanel.tsx should use going
 * forward. Wraps the existing, UNCHANGED analyzeSentenceWithComplementVerification() (Qwen
 * GrammarAnalysis + every focused repair, exactly as before) and, when the local Stanza
 * syntax service succeeds, OVERRIDES effectiveCore/effectiveCoreSet with the Stanza-derived
 * canonical authority. Nothing about the Qwen pipeline changes: none of its repairs are
 * skipped, none of its output is mutated -- Stanza authority is applied strictly AFTER, so it
 * can never be silently touched by repair logic designed for a different authority (item 13).
 *
 * Failure policy (item 19): if the Stanza service is unavailable or its parse fails
 * validation, this does NOT silently treat the Qwen core as equivalent-quality canonical
 * authority. `syntaxAuthority.source` is explicitly 'legacy-qwen-fallback' (never silently
 * labelled 'stanza'), a console warning is emitted exactly once per failed sentence, and the
 * existing Qwen-derived effectiveCore/effectiveCoreSet is what the (unredesigned) UI ends up
 * displaying -- the application stays stable and usable rather than showing nothing, but the
 * degraded-authority fact is never hidden from anything that inspects the result.
 *
 * Prototype 2.6G2 additionally carries the raw `stanzaTokens` through on the 'stanza' path so
 * AnalysisResultPanel.tsx can build the full hierarchical Structure Tree
 * (stanzaStructureTree.ts) from the exact same authority the canonical SentenceCoreSet came
 * from, instead of re-deriving anything. `stanzaTokens` is null on the legacy-fallback path --
 * the legacy Tree builder (structureTree.ts) does not need them.
 */

export type SyntaxAuthoritySource = 'stanza' | 'legacy-qwen-fallback'

export interface SyntaxAuthorityMeta {
  source: SyntaxAuthoritySource
  /** Populated only when source === 'legacy-qwen-fallback'. */
  unavailableReason: string | null
}

export interface VerifiedSentenceAnalysisWithSyntaxAuthority extends VerifiedSentenceAnalysis {
  syntaxAuthority: SyntaxAuthorityMeta
  /** Non-null exactly when syntaxAuthority.source === 'stanza'. */
  stanzaTokens: StanzaToken[] | null
}

export type AnalyzeWithSyntaxAuthorityOutcome =
  | { success: true; result: VerifiedSentenceAnalysisWithSyntaxAuthority; recoveryUsed: boolean }
  | { success: false; error: string }

export async function analyzeSentenceWithSyntaxAuthority(
  options: AnalyzeSentenceWithComplementVerificationOptions,
): Promise<AnalyzeWithSyntaxAuthorityOutcome> {
  const outcome: AnalyzeWithComplementVerificationOutcome = await analyzeSentenceWithComplementVerification(options)
  if (!outcome.success) return outcome

  const syntax = await analyzeSyntaxAuthority(options.sentence)

  if (syntax.status === 'ok') {
    return {
      success: true,
      recoveryUsed: outcome.recoveryUsed,
      result: {
        ...outcome.result,
        effectiveCoreSet: syntax.coreSet,
        effectiveCore: projectPrimaryCore(syntax.coreSet),
        syntaxAuthority: { source: 'stanza', unavailableReason: null },
        stanzaTokens: syntax.tokens,
      },
    }
  }

  // eslint-disable-next-line no-console -- intentionally non-silent (item 19): never pretend
  // the legacy Qwen core is Stanza-quality canonical authority without saying so somewhere.
  console.warn(`[stanzaSyntaxAuthority] unavailable for this sentence, falling back to legacy Qwen core: ${syntax.reason}`)
  return {
    success: true,
    recoveryUsed: outcome.recoveryUsed,
    result: {
      ...outcome.result,
      syntaxAuthority: { source: 'legacy-qwen-fallback', unavailableReason: syntax.reason },
      stanzaTokens: null,
    },
  }
}

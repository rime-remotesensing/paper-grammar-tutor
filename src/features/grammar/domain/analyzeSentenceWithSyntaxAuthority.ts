import { GRAMMAR_ANALYSIS_PROMPT_VERSION } from '../../../llm/prompts/grammarAnalysisPrompt.ts'
import { recordStageTiming } from '../../../llm/timing.ts'
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

/**
 * In-memory cache for the whole pipeline this function orchestrates (Qwen grammar analysis +
 * every focused-repair gate + the Stanza syntax authority lookup), keyed on the exact
 * sentence text, model, temperature, and the grammar-analysis prompt/schema version so a
 * prompt-wording change can never silently reuse a stale cached result. Entirely separate
 * from analyzeSyntaxAuthority.ts's own Stanza-only cache (different key space, different
 * Map) -- this cache exists to skip the far more expensive Qwen chain on a repeat selection
 * of the same sentence, not to replace the Stanza cache. Values are promises so concurrent
 * requests for the same key share one run instead of firing the Qwen chain twice; a failed
 * outcome is evicted immediately so the next "解析" click gets a clean retry.
 */
let cache = new Map<string, Promise<AnalyzeWithSyntaxAuthorityOutcome>>()

export function resetSentenceAnalysisCache(): void {
  cache = new Map()
}

function cacheKey(options: AnalyzeSentenceWithComplementVerificationOptions): string {
  return `v${GRAMMAR_ANALYSIS_PROMPT_VERSION}|${options.model}|${options.temperature}|${options.sentence}`
}

export async function analyzeSentenceWithSyntaxAuthority(
  options: AnalyzeSentenceWithComplementVerificationOptions,
): Promise<AnalyzeWithSyntaxAuthorityOutcome> {
  const key = cacheKey(options)
  const cached = cache.get(key)
  if (cached) return cached

  const promise = runAnalyzeSentenceWithSyntaxAuthority(options)
  cache.set(key, promise)
  const result = await promise
  if (!result.success && cache.get(key) === promise) cache.delete(key)
  return result
}

async function runAnalyzeSentenceWithSyntaxAuthority(
  options: AnalyzeSentenceWithComplementVerificationOptions,
): Promise<AnalyzeWithSyntaxAuthorityOutcome> {
  const startedAt = performance.now()
  // The Stanza syntax lookup only ever depends on the raw sentence text (see
  // analyzeSyntaxAuthority.ts's own doc comment: "never reads or is informed by Qwen/
  // GrammarAnalysis output") -- it is safe to run concurrently with the whole Qwen chain
  // rather than strictly after it, since neither result feeds the other's input.
  const [outcome, syntax]: [AnalyzeWithComplementVerificationOutcome, Awaited<ReturnType<typeof analyzeSyntaxAuthority>>] =
    await Promise.all([
      analyzeSentenceWithComplementVerification(options),
      analyzeSyntaxAuthority(options.sentence),
    ])
  recordStageTiming('analyzeSentenceWithSyntaxAuthority (grammar+stanza, parallel)', performance.now() - startedAt)
  if (!outcome.success) return outcome

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

import type { LLMProvider } from '../../../llm/types.ts'
import { buildForcedCorePrompt } from '../../../llm/prompts/forcedCorePrompt.ts'
import { tryParseJson } from '../../../utils/jsonExtract.ts'
import { resolveSpan } from '../../../utils/spanMatch.ts'
import { forcedCoreSchema } from '../schemas/forcedCore.schema.ts'
import { FORCED_CORE_JSON_SCHEMA } from '../schemas/forcedCore.jsonSchema.ts'
import type { GrammarAnalysis, Span, SentenceCore } from '../schemas/grammarAnalysis.schema.ts'
import { attachDerivedPattern } from './derivePattern.ts'

/**
 * True when both spans have resolved (non-negative) offsets and their ranges intersect,
 * treating start/end as a half-open [start, end) interval — so `a.end === b.start`
 * (merely adjacent) is NOT an overlap. Unresolved spans (start/end -1, i.e. the app
 * could not locate the model's claimed text in the sentence at all) can't be compared
 * meaningfully, so they never count as overlapping — that failure mode is already
 * surfaced separately via `uncertainties`, not through this gate.
 */
function spansOverlap(a: Span, b: Span): boolean {
  if (a.start < 0 || a.end < 0 || b.start < 0 || b.end < 0) return false
  return Math.max(a.start, b.start) < Math.min(a.end, b.end)
}

/** True when `inner` falls fully within `outer`'s [start, end] bounds (inclusive). */
function isContainedWithin(outer: Span, inner: Span): boolean {
  if (outer.start < 0 || inner.start < 0) return true
  return outer.start <= inner.start && inner.end <= outer.end
}

/**
 * A "core failure" is when the primary GrammarAnalysis request produced a sentenceCore
 * that cannot be trusted as-is — either because the minimum needed for Stage 1 (S/V) is
 * missing, or because the model's own spans are structurally self-contradictory. This is
 * a purely mechanical, hard structural check over spans the model itself already
 * produced — it does not add any grammatical judgement of its own (see
 * docs/design-notes.md, Phase G, for why the check is deliberately limited to this).
 *
 * Missing object/complement alone is normal (not every sentence has them) and must NOT
 * trigger recovery.
 *
 * Conditions (OR'd together):
 * 1. subject is null.
 * 2. verb is null.
 * 3. the resolved subject and verb spans overlap (a real example: subject was returned
 *    as the whole clause "The sensor recorded data" while verb was correctly "recorded"
 *    — subjectHead/verb/object were all individually right, but subject swallowed the
 *    entire clause, which is self-contradictory within the same response).
 * 4. subjectHead is present but its resolved span is not contained within the resolved
 *    subject span.
 */
export function isSentenceCoreFailure(core: {
  subject: Span | null
  subjectHead: Span | null
  verb: Span | null
}): boolean {
  if (core.subject === null) return true
  if (core.verb === null) return true
  if (spansOverlap(core.subject, core.verb)) return true
  if (core.subjectHead !== null && !isContainedWithin(core.subject, core.subjectHead)) return true
  return false
}

export interface RecoverSentenceCoreOptions {
  provider: LLMProvider
  model: string
  /** The normalized sentence text the original analysis was run against. */
  sentence: string
  temperature: number
}

export type RecoverSentenceCoreResult =
  | { success: true; sentenceCore: SentenceCore }
  | { success: false; error: string }

/**
 * The user-triggered-only "骨格だけ再解析" second call. Never invoked automatically by
 * analyzeSentence or from an effect — see AnalysisResultPanel, which only calls this from
 * an explicit button click, precisely because forcing non-null subject/verb is unsafe to
 * apply to input that might actually be a sentence fragment.
 */
export async function recoverSentenceCore(
  options: RecoverSentenceCoreOptions,
): Promise<RecoverSentenceCoreResult> {
  const prompt = buildForcedCorePrompt(options.sentence)
  const generation = await options.provider.generateStructured({
    model: options.model,
    systemPrompt: prompt.system,
    userPrompt: prompt.user,
    jsonSchema: FORCED_CORE_JSON_SCHEMA,
    temperature: options.temperature,
  })

  const parsed = tryParseJson(generation.rawText)
  if ('error' in parsed) {
    return { success: false, error: `JSONとして解析できませんでした: ${parsed.error}` }
  }
  const result = forcedCoreSchema.safeParse(parsed.value)
  if (!result.success) {
    return { success: false, error: result.error.issues.map((i) => i.message).join('; ') }
  }

  const resolve = (span: Span): Span => {
    const resolved = resolveSpan(options.sentence, span)
    return { text: resolved.text, start: resolved.start, end: resolved.end }
  }
  const resolveNullable = (span: Span | null): Span | null => (span ? resolve(span) : null)

  const resolvedCore = {
    subject: resolve(result.data.subject),
    subjectHead: resolve(result.data.subjectHead),
    verb: resolve(result.data.verb),
    indirectObject: resolveNullable(result.data.indirectObject),
    object: resolveNullable(result.data.object),
    complement: resolveNullable(result.data.complement),
  }

  // The forced-core schema already requires subject/subjectHead/verb, so conditions 1/2
  // of isSentenceCoreFailure can't fire here — but the overlap/containment checks (3/4)
  // still can, since nothing about the forced-core schema prevents the model from
  // repeating the same "subject swallows the whole clause" mistake. Never merge a
  // recovered core that is itself structurally broken; the caller keeps the original
  // GrammarAnalysis and treats this the same as any other recovery failure.
  if (isSentenceCoreFailure(resolvedCore)) {
    return {
      success: false,
      error: '再解析結果も構造的な矛盾を含んでいたため採用しませんでした。',
    }
  }

  return { success: true, sentenceCore: attachDerivedPattern(resolvedCore) }
}

/**
 * Replaces `sentenceCore` on an existing GrammarAnalysis with a recovered one — a
 * conservative merge, not a blind overwrite. Everything outside sentenceCore (chunks,
 * modifiers, clauses, phrases, vocabulary, readingHint, confidence, uncertainties,
 * needsMoreContext, referenceTranslation) is preserved untouched; the forced-core call
 * is sentenceCore-repair only, not a re-analysis.
 *
 * Within sentenceCore itself:
 * - subject/subjectHead/verb (the mandatory fields forced-core exists to fix) always
 *   come from the recovered core.
 * - indirectObject/object/complement (optional — forced-core's schema allows them to be
 *   null) fall back to the ORIGINAL analysis's value whenever recovered is null, so a
 *   correct object/complement the primary analysis already found isn't discarded just
 *   because the recovery call didn't happen to repeat it. This is purely a null-fallback
 *   — it does not second-guess or "correct" either side's answer when both are non-null
 *   (recovered wins there too, since it was produced under the same constraints as
 *   subject/verb and re-deciding between two non-null answers would be a semantic
 *   judgement this function is not meant to make).
 * - pattern is always recomputed from the final merged constituents, never taken
 *   directly from either source, so it can never disagree with them.
 */
export function mergeRecoveredSentenceCore(
  analysis: GrammarAnalysis,
  recoveredCore: SentenceCore,
): GrammarAnalysis {
  const original = analysis.sentenceCore
  const merged = {
    subject: recoveredCore.subject,
    subjectHead: recoveredCore.subjectHead,
    verb: recoveredCore.verb,
    indirectObject: recoveredCore.indirectObject ?? original.indirectObject,
    object: recoveredCore.object ?? original.object,
    complement: recoveredCore.complement ?? original.complement,
  }
  return { ...analysis, sentenceCore: attachDerivedPattern(merged) }
}

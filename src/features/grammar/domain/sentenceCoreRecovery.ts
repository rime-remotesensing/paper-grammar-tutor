import type { LLMProvider } from '../../../llm/types.ts'
import { buildForcedCorePrompt } from '../../../llm/prompts/forcedCorePrompt.ts'
import { tryParseJson } from '../../../utils/jsonExtract.ts'
import { resolveSpan } from '../../../utils/spanMatch.ts'
import { forcedCoreSchema } from '../schemas/forcedCore.schema.ts'
import { FORCED_CORE_JSON_SCHEMA } from '../schemas/forcedCore.jsonSchema.ts'
import type { GrammarAnalysis, Span, SentenceCore, SentenceCoreSet } from '../schemas/grammarAnalysis.schema.ts'
import { attachDerivedPattern } from './derivePattern.ts'
import { materializeSentenceCoreSet, projectPrimaryCore, replacePrimaryCoreFromRepair } from './sentenceCoreSet.ts'
import { classifySentenceCoreFailure } from './sentenceCoreFailureReason.ts'

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
 * Prototype 2.3L: this boolean is now a thin wrapper over
 * sentenceCoreFailureReason.ts's classifySentenceCoreFailure() — the finer-grained SSOT
 * used by analyzeSentenceWithAutoRecovery.ts to route each failure reason to the repair
 * strategy validated for that specific shape (SUBJECT_VERB_OVERLAP -> Focused
 * Subject-Verb Repair; everything else -> existing forced-core recovery). Behavior here
 * is byte-for-byte unchanged from the original inline implementation — see that file's
 * own comment for why the classifier's failure surface is kept exactly boolean-equivalent
 * (no silent widening from the UNGROUNDED_* diagnostic categories).
 */
export function isSentenceCoreFailure(core: {
  subject: Span | null
  subjectHead: Span | null
  verb: Span | null
}): boolean {
  return classifySentenceCoreFailure(core) !== 'NONE'
}

export interface RecoverSentenceCoreOptions {
  provider: LLMProvider
  model: string
  /** The normalized sentence text the original analysis was run against. */
  sentence: string
  temperature: number
}

export type RecoverSentenceCoreResult =
  | { success: true; sentenceCore: SentenceCore; sentenceCoreSet: SentenceCoreSet }
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
  const subject = resolve(result.data.subject)
  const subjectHead = resolve(result.data.subjectHead)
  let cursor = subject.end
  const predicateCores = result.data.predicateCores.map((core) => {
    const verbStart = options.sentence.indexOf(core.verb.text, Math.max(0, cursor))
    const verb = verbStart >= 0
      ? { text: core.verb.text, start: verbStart, end: verbStart + core.verb.text.length }
      : resolve(core.verb)
    const connectorStart = core.connector && verb.start >= cursor
      ? options.sentence.indexOf(core.connector.text, cursor)
      : -1
    const connector = core.connector && connectorStart >= cursor && connectorStart + core.connector.text.length <= verb.start
      ? { text: core.connector.text, start: connectorStart, end: connectorStart + core.connector.text.length }
      : null
    if (verb.start >= 0) cursor = verb.end
    return {
      connector,
      verb,
      indirectObject: resolveNullable(core.indirectObject),
      object: resolveNullable(core.object),
      complement: resolveNullable(core.complement),
    }
  })
  const resolvedCoreSet = materializeSentenceCoreSet({ subject, subjectHead, predicateCores })
  const resolvedCore = projectPrimaryCore(resolvedCoreSet)

  // The forced-core schema already requires subject/subjectHead/verb, so conditions 1/2
  // of isSentenceCoreFailure can't fire here — but the overlap/containment checks (3/4)
  // still can, since nothing about the forced-core schema prevents the model from
  // repeating the same "subject swallows the whole clause" mistake. Never merge a
  // recovered core that is itself structurally broken; the caller keeps the original
  // GrammarAnalysis and treats this the same as any other recovery failure.
  if (resolvedCoreSet.predicateCores.some((core) => isSentenceCoreFailure({ subject, subjectHead, verb: core.verb }))) {
    return {
      success: false,
      error: '再解析結果も構造的な矛盾を含んでいたため採用しませんでした。',
    }
  }

  return { success: true, sentenceCore: resolvedCore, sentenceCoreSet: resolvedCoreSet }
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
  recovered: SentenceCore | SentenceCoreSet,
): GrammarAnalysis {
  if ('predicateCores' in recovered) {
    const predicateCores = recovered.predicateCores.map((core, index) => {
      const original = analysis.sentenceCoreSet.predicateCores[index]
      const slots = {
        ...core,
        indirectObject: core.indirectObject ?? original?.indirectObject ?? null,
        object: core.object ?? original?.object ?? null,
        complement: core.complement ?? original?.complement ?? null,
      }
      return { ...slots, pattern: attachDerivedPattern({
        subject: recovered.subject,
        subjectHead: recovered.subjectHead,
        verb: slots.verb,
        indirectObject: slots.indirectObject,
        object: slots.object,
        complement: slots.complement,
      }).pattern }
    })
    const sentenceCoreSet = { ...recovered, predicateCores }
    return { ...analysis, sentenceCoreSet, sentenceCore: projectPrimaryCore(sentenceCoreSet) }
  }
  const recoveredCore = recovered
  const original = analysis.sentenceCore
  const merged = {
    subject: recoveredCore.subject,
    subjectHead: recoveredCore.subjectHead,
    verb: recoveredCore.verb,
    indirectObject: recoveredCore.indirectObject ?? original.indirectObject,
    object: recoveredCore.object ?? original.object,
    complement: recoveredCore.complement ?? original.complement,
  }
  const sentenceCoreSet = replacePrimaryCoreFromRepair(analysis.sentenceCoreSet, attachDerivedPattern(merged))
  return { ...analysis, sentenceCoreSet, sentenceCore: projectPrimaryCore(sentenceCoreSet) }
}

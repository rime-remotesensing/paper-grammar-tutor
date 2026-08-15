import { MAX_REPAIR_ATTEMPTS } from '../../../config/settings.ts'
import { FOCUSED_SUBJECT_VERB_REPAIR_JSON_SCHEMA } from '../schemas/focusedSubjectVerbRepair.jsonSchema.ts'
import { llmFocusedSubjectVerbRepairSchema } from '../schemas/focusedSubjectVerbRepair.schema.ts'
import type { LLMProvider } from '../../../llm/types.ts'
import {
  buildFocusedSubjectVerbRepairPrompt,
  buildFocusedSubjectVerbRepairRepairPrompt,
} from '../../../llm/prompts/focusedSubjectVerbRepairPrompt.ts'
import { tryParseJson } from '../../../utils/jsonExtract.ts'
import { resolveSpan } from '../../../utils/spanMatch.ts'
import type { Span } from '../schemas/grammarAnalysis.schema.ts'

export interface RepairFocusedSubjectVerbOptions {
  provider: LLMProvider
  model: string
  sentence: string
  temperature: number
}

export interface FocusedSubjectVerbRepairResult {
  subject: Span
  subjectHead: Span
  verb: Span
}

export type RepairFocusedSubjectVerbOutcome =
  | { success: true; result: FocusedSubjectVerbRepairResult }
  | { success: false; error: string }

/**
 * Orchestrates the Focused Subject-Verb Repair call (Prototype 2.3L, production port of
 * the Prototype 2.3J/2.3K spike): prompt -> LLM -> JSON parse -> Zod -> source grounding ->
 * (one repair attempt, covering parse/schema/grounding failures alike) -> result. Fully
 * independent of GrammarAnalyzer/ReadingGuideAnalyzer/PredicateStructureAnalyzer/
 * FocusedComplementVerifier — its own prompt, its own schema, only ever invoked when
 * sentenceCoreFailureReason.ts's classifySentenceCoreFailure() returns
 * 'SUBJECT_VERB_OVERLAP' (see analyzeSentenceWithAutoRecovery.ts).
 *
 * Never throws for LLM-quality problems; always resolves to a Result so a repair failure
 * falls back to the existing safe-failure UX (item 25 of the 2.3L order: never blind-
 * cascade to forced-core, which the 2.3J/2.3K spikes measured as structurally unsuited to
 * this exact failure shape — 0/30 correct on the primary target).
 */
export async function repairFocusedSubjectVerb(
  options: RepairFocusedSubjectVerbOptions,
): Promise<RepairFocusedSubjectVerbOutcome> {
  const { provider, model, sentence, temperature } = options

  const prompt = buildFocusedSubjectVerbRepairPrompt(sentence)
  let generation = await provider.generateStructured({
    model,
    systemPrompt: prompt.system,
    userPrompt: prompt.user,
    jsonSchema: FOCUSED_SUBJECT_VERB_REPAIR_JSON_SCHEMA,
    temperature,
  })

  let attempt = validate(generation.rawText, sentence)

  for (let repairCount = 0; repairCount < MAX_REPAIR_ATTEMPTS && !attempt.success; repairCount++) {
    const repairPrompt = buildFocusedSubjectVerbRepairRepairPrompt(sentence, generation.rawText, attempt.error)
    generation = await provider.generateStructured({
      model,
      systemPrompt: repairPrompt.system,
      userPrompt: repairPrompt.user,
      jsonSchema: FOCUSED_SUBJECT_VERB_REPAIR_JSON_SCHEMA,
      temperature,
    })
    attempt = validate(generation.rawText, sentence)
  }

  if (!attempt.success) {
    return { success: false, error: attempt.error }
  }

  return { success: true, result: attempt.result }
}

type ValidationOutcome = { success: true; result: FocusedSubjectVerbRepairResult } | { success: false; error: string }

function validate(rawText: string, sentence: string): ValidationOutcome {
  const parsed = tryParseJson(rawText)
  if ('error' in parsed) {
    return { success: false, error: `JSONとして解析できませんでした: ${parsed.error}` }
  }
  const result = llmFocusedSubjectVerbRepairSchema.safeParse(parsed.value)
  if (!result.success) {
    return { success: false, error: result.error.issues.map((issue) => issue.message).join('; ') }
  }

  const subject = resolveSpan(sentence, { text: result.data.subject, start: -1, end: -1 })
  const subjectHead = resolveSpan(sentence, { text: result.data.subjectHead, start: -1, end: -1 })
  const verb = resolveSpan(sentence, { text: result.data.verb, start: -1, end: -1 })
  if (!subject.resolved) return { success: false, error: `subject「${result.data.subject}」が原文中に見つかりませんでした。` }
  if (!subjectHead.resolved) return { success: false, error: `subjectHead「${result.data.subjectHead}」が原文中に見つかりませんでした。` }
  if (!verb.resolved) return { success: false, error: `verb「${result.data.verb}」が原文中に見つかりませんでした。` }

  return {
    success: true,
    result: {
      subject: { text: subject.text, start: subject.start, end: subject.end },
      subjectHead: { text: subjectHead.text, start: subjectHead.start, end: subjectHead.end },
      verb: { text: verb.text, start: verb.start, end: verb.end },
    },
  }
}

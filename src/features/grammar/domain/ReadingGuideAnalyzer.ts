import { MAX_REPAIR_ATTEMPTS } from '../../../config/settings.ts'
import { READING_GUIDE_JSON_SCHEMA } from '../schemas/readingGuide.jsonSchema.ts'
import { llmReadingGuideSchema, type ReadingGuide } from '../schemas/readingGuide.schema.ts'
import type { LLMProvider } from '../../../llm/types.ts'
import {
  buildReadingGuidePrompt,
  buildReadingGuideRepairPrompt,
} from '../../../llm/prompts/readingGuidePrompt.ts'
import { tryParseJson } from '../../../utils/jsonExtract.ts'
import { groundReadingGuide } from './readingGuideGrounding.ts'

export interface AnalyzeReadingGuideOptions {
  provider: LLMProvider
  model: string
  /** The exact text readingSteps/expressions are grounded against — must be the same text
   * sentenceCore's own spans were resolved against (GrammarAnalysis.normalizedText), not
   * the raw pre-normalization input, or grounding will spuriously fail. */
  sentence: string
  temperature: number
}

export type AnalyzeReadingGuideResult =
  | { success: true; readingGuide: ReadingGuide }
  | { success: false; error: string }

/**
 * Orchestrates the "英語の語順で読む" second call: prompt -> LLM -> JSON parse -> Zod ->
 * (one repair attempt, covering both schema failures and grounding/order failures) ->
 * source grounding -> ReadingGuide. Mirrors GrammarAnalyzer's shape but is fully
 * independent: its own prompt, its own schema, never invoked from analyzeSentence, and
 * never shares a call with it (Prototype 2.1 item 3 — this must stay a second, separate
 * LLM call, only triggered by an explicit user click).
 *
 * Prototype 2.3C: no `sentenceCore` parameter — ReadingGuide is purely a left-to-right
 * reading aid now (see readingGuide.schema.ts); the structural tree is a fully separate
 * pipeline (PredicateStructureAnalyzer.ts + hybridPredicateMerger.ts).
 *
 * Never throws for LLM-quality problems; always resolves to a Result so a Reading Guide
 * failure can be shown as a narrow, retryable UI state without disturbing the
 * already-displayed GrammarAnalysis/sentenceCore or the independent structure tree.
 */
export async function analyzeReadingGuide(
  options: AnalyzeReadingGuideOptions,
): Promise<AnalyzeReadingGuideResult> {
  const { provider, model, sentence, temperature } = options

  const prompt = buildReadingGuidePrompt(sentence)
  let generation = await provider.generateStructured({
    model,
    systemPrompt: prompt.system,
    userPrompt: prompt.user,
    jsonSchema: READING_GUIDE_JSON_SCHEMA,
    temperature,
  })

  let attempt = validate(generation.rawText, sentence)

  for (let repairCount = 0; repairCount < MAX_REPAIR_ATTEMPTS && !attempt.success; repairCount++) {
    const repairPrompt = buildReadingGuideRepairPrompt(sentence, generation.rawText, attempt.error)
    generation = await provider.generateStructured({
      model,
      systemPrompt: repairPrompt.system,
      userPrompt: repairPrompt.user,
      jsonSchema: READING_GUIDE_JSON_SCHEMA,
      temperature,
    })
    attempt = validate(generation.rawText, sentence)
  }

  if (!attempt.success) {
    return { success: false, error: attempt.error }
  }

  return { success: true, readingGuide: attempt.readingGuide }
}

type ValidationOutcome =
  | { success: true; readingGuide: ReadingGuide }
  | { success: false; error: string }

function validate(rawText: string, sentence: string): ValidationOutcome {
  const parsed = tryParseJson(rawText)
  if ('error' in parsed) {
    return { success: false, error: `JSONとして解析できませんでした: ${parsed.error}` }
  }
  const result = llmReadingGuideSchema.safeParse(parsed.value)
  if (!result.success) {
    return { success: false, error: formatZodIssues(result.error.issues) }
  }
  const grounded = groundReadingGuide(result.data, sentence)
  if (!grounded.success) {
    return { success: false, error: grounded.error }
  }
  return { success: true, readingGuide: grounded.readingGuide }
}

function formatZodIssues(issues: ReadonlyArray<{ path: PropertyKey[]; message: string }>): string {
  return issues
    .map((issue) => {
      const path = issue.path.join('.')
      return path ? `${path}: ${issue.message}` : issue.message
    })
    .join('; ')
}

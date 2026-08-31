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
import type { TreeReadingTarget } from './treeReadingTargets.ts'

export interface AnalyzeReadingGuideOptions {
  provider: LLMProvider
  model: string
  /** Normalized sentence authority. Only Expressions are text-grounded; reading notes use
   * application-supplied target IDs. */
  sentence: string
  targets: readonly TreeReadingTarget[]
  temperature: number
}

export type AnalyzeReadingGuideResult =
  | { success: true; readingGuide: ReadingGuide; invalidTargetIds: string[]; duplicateTargetIds: string[] }
  | { success: false; error: string }

/**
 * Orchestrates the single ReadingGuide call after final Tree targets exist: prompt -> LLM
 * -> JSON parse -> Zod -> target-ID validation / Expression grounding -> ReadingGuide.
 * One repair attempt remains available for malformed JSON/schema output. Unknown IDs are
 * safely reported and dropped; they do not trigger a second semantic generation.
 *
 * Never throws for LLM-quality problems; always resolves to a Result so a Reading Guide
 * failure can be shown as a narrow, retryable UI state without disturbing the
 * already-displayed GrammarAnalysis/sentenceCore or the independent structure tree.
 */
export async function analyzeReadingGuide(
  options: AnalyzeReadingGuideOptions,
): Promise<AnalyzeReadingGuideResult> {
  const { provider, model, sentence, targets, temperature } = options

  const prompt = buildReadingGuidePrompt(sentence, targets)
  let generation = await provider.generateStructured({
    model,
    systemPrompt: prompt.system,
    userPrompt: prompt.user,
    jsonSchema: READING_GUIDE_JSON_SCHEMA,
    temperature,
    callLabel: 'reading-guide.initial',
  })

  let attempt = validate(generation.rawText, sentence, targets)

  for (let repairCount = 0; repairCount < MAX_REPAIR_ATTEMPTS && !attempt.success; repairCount++) {
    const repairPrompt = buildReadingGuideRepairPrompt(sentence, targets, generation.rawText, attempt.error)
    generation = await provider.generateStructured({
      model,
      systemPrompt: repairPrompt.system,
      userPrompt: repairPrompt.user,
      jsonSchema: READING_GUIDE_JSON_SCHEMA,
      temperature,
      callLabel: `reading-guide.repair.${repairCount + 1}`,
    })
    attempt = validate(generation.rawText, sentence, targets)
  }

  if (!attempt.success) {
    return { success: false, error: attempt.error }
  }

  return {
    success: true,
    readingGuide: attempt.readingGuide,
    invalidTargetIds: attempt.invalidTargetIds,
    duplicateTargetIds: attempt.duplicateTargetIds,
  }
}

type ValidationOutcome =
  | { success: true; readingGuide: ReadingGuide; invalidTargetIds: string[]; duplicateTargetIds: string[] }
  | { success: false; error: string }

function validate(rawText: string, sentence: string, targets: readonly TreeReadingTarget[]): ValidationOutcome {
  const parsed = tryParseJson(rawText)
  if ('error' in parsed) {
    return { success: false, error: `JSONとして解析できませんでした: ${parsed.error}` }
  }
  const result = llmReadingGuideSchema.safeParse(parsed.value)
  if (!result.success) {
    return { success: false, error: formatZodIssues(result.error.issues) }
  }
  const grounded = groundReadingGuide(result.data, sentence, targets)
  return {
    success: true,
    readingGuide: grounded.readingGuide,
    invalidTargetIds: grounded.invalidTargetIds,
    duplicateTargetIds: grounded.duplicateTargetIds,
  }
}

function formatZodIssues(issues: ReadonlyArray<{ path: PropertyKey[]; message: string }>): string {
  return issues
    .map((issue) => {
      const path = issue.path.join('.')
      return path ? `${path}: ${issue.message}` : issue.message
    })
    .join('; ')
}

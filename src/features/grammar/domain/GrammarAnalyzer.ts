import { MAX_REPAIR_ATTEMPTS } from '../../../config/settings.ts'
import { GRAMMAR_ANALYSIS_JSON_SCHEMA } from '../schemas/grammarAnalysis.jsonSchema.ts'
import {
  llmGrammarAnalysisSchema,
  type GrammarAnalysis,
  type LlmGrammarAnalysis,
} from '../schemas/grammarAnalysis.schema.ts'
import type { LLMProvider } from '../../../llm/types.ts'
import {
  buildGrammarAnalysisPrompt,
  buildRepairPrompt,
} from '../../../llm/prompts/grammarAnalysisPrompt.ts'
import { recordStageTiming } from '../../../llm/timing.ts'
import { normalizeSentence } from '../../../utils/textNormalize.ts'
import { tryParseJson } from '../../../utils/jsonExtract.ts'
import { buildFallbackAnalysis } from './fallbackAnalysis.ts'
import { resolveAnalysisSpans } from './resolveAnalysisSpans.ts'
import { materializeSentenceCoreSet, projectPrimaryCore, validateGroundedSentenceCoreSet } from './sentenceCoreSet.ts'

export interface AnalyzeSentenceOptions {
  provider: LLMProvider
  model: string
  sentence: string
  temperature: number
}

export interface AnalyzeSentenceMeta {
  schemaValid: boolean
  regenerated: boolean
  elapsedMs: number
  rawModelText: string
  parseError: string | null
}

export interface AnalyzeSentenceResult {
  analysis: GrammarAnalysis
  meta: AnalyzeSentenceMeta
}

/**
 * Orchestrates one grammar-analysis request: prompt -> LLM -> parse -> validate
 * -> (one repair attempt if needed) -> span verification -> GrammarAnalysis.
 * Never throws for LLM-quality problems (bad JSON, failed validation); it always
 * resolves to a usable GrammarAnalysis, with failure surfaced via `meta` and
 * `uncertainties` instead.
 */
export async function analyzeSentence(
  options: AnalyzeSentenceOptions,
): Promise<AnalyzeSentenceResult> {
  const { provider, model, temperature } = options
  const originalText = options.sentence
  const normalizedText = normalizeSentence(originalText)

  let totalElapsedMs = 0
  let regenerated = false

  const prompt = buildGrammarAnalysisPrompt(normalizedText)
  let generation = await provider.generateStructured({
    model,
    systemPrompt: prompt.system,
    userPrompt: prompt.user,
    jsonSchema: GRAMMAR_ANALYSIS_JSON_SCHEMA,
    temperature,
    callLabel: 'grammar-analysis.initial',
  })
  totalElapsedMs += generation.elapsedMs

  let attempt = validate(generation.rawText, normalizedText)

  for (let repairCount = 0; repairCount < MAX_REPAIR_ATTEMPTS && !attempt.success; repairCount++) {
    regenerated = true
    const repairPrompt = buildRepairPrompt(normalizedText, generation.rawText, attempt.error)
    generation = await provider.generateStructured({
      model,
      systemPrompt: repairPrompt.system,
      userPrompt: repairPrompt.user,
      jsonSchema: GRAMMAR_ANALYSIS_JSON_SCHEMA,
      temperature,
      callLabel: `grammar-analysis.repair.${repairCount + 1}`,
    })
    totalElapsedMs += generation.elapsedMs
    attempt = validate(generation.rawText, normalizedText)
  }

  recordStageTiming('grammar analysis LLM (+ repairs)', totalElapsedMs)

  if (!attempt.success) {
    return {
      analysis: buildFallbackAnalysis(
        originalText,
        normalizedText,
        `解析結果の形式が不正なため表示できませんでした（${attempt.error}）。文を短くするか、別のモデルをお試しください。`,
      ),
      meta: {
        schemaValid: false,
        regenerated,
        elapsedMs: totalElapsedMs,
        rawModelText: generation.rawText,
        parseError: attempt.error,
      },
    }
  }

  const { analysis: resolved, unresolvedNotes } = resolveAnalysisSpans(
    attempt.data,
    normalizedText,
  )

  const sentenceCoreSet = materializeSentenceCoreSet(resolved.sentenceCoreSet)
  const coreSetIssues = validateGroundedSentenceCoreSet(sentenceCoreSet)
  const analysis: GrammarAnalysis = {
    ...resolved,
    sentenceCoreSet,
    sentenceCore: projectPrimaryCore(sentenceCoreSet),
    originalText,
    normalizedText,
    uncertainties: [...resolved.uncertainties, ...unresolvedNotes, ...coreSetIssues.map((issue) => `述語コア検証: ${issue}`)],
  }

  return {
    analysis,
    meta: {
      schemaValid: true,
      regenerated,
      elapsedMs: totalElapsedMs,
      rawModelText: generation.rawText,
      parseError: null,
    },
  }
}

type ValidationOutcome =
  | { success: true; data: LlmGrammarAnalysis }
  | { success: false; error: string }

function validate(rawText: string, normalizedText: string): ValidationOutcome {
  const parsed = tryParseJson(rawText)
  if ('error' in parsed) {
    return { success: false, error: `JSONとして解析できませんでした: ${parsed.error}` }
  }
  const result = llmGrammarAnalysisSchema.safeParse(parsed.value)
  if (!result.success) {
    return { success: false, error: formatZodIssues(result.error.issues) }
  }
  const resolved = resolveAnalysisSpans(result.data, normalizedText).analysis
  const structuralIssues = validateGroundedSentenceCoreSet(materializeSentenceCoreSet(resolved.sentenceCoreSet))
  if (structuralIssues.length > 0) {
    return { success: false, error: structuralIssues.map((issue) => `sentenceCoreSet: ${issue}`).join('; ') }
  }
  return { success: true, data: result.data }
}

/** Keeps the field path in validation-error text (e.g. "confidence: Too big: ..." or
 * "chunks.2.order: ...") instead of just the bare message, so a failure can be traced
 * back to the offending field from `meta.parseError` alone. */
function formatZodIssues(issues: ReadonlyArray<{ path: PropertyKey[]; message: string }>): string {
  return issues
    .map((issue) => {
      const path = issue.path.join('.')
      return path ? `${path}: ${issue.message}` : issue.message
    })
    .join('; ')
}

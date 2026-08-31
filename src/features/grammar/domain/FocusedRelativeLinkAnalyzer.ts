import { MAX_REPAIR_ATTEMPTS } from '../../../config/settings.ts'
import { FOCUSED_RELATIVE_LINK_JSON_SCHEMA } from '../schemas/focusedRelativeLink.jsonSchema.ts'
import { llmFocusedRelativeLinkSchema, type LlmFocusedRelativeLinkRelation } from '../schemas/focusedRelativeLink.schema.ts'
import type { LLMProvider } from '../../../llm/types.ts'
import { buildFocusedRelativeLinkPrompt, buildFocusedRelativeLinkRepairPrompt } from '../../../llm/prompts/focusedRelativeLinkPrompt.ts'
import { tryParseJson } from '../../../utils/jsonExtract.ts'

export interface AnalyzeFocusedRelativeLinkOptions {
  provider: LLMProvider
  model: string
  sentence: string
  temperature: number
}

export type AnalyzeFocusedRelativeLinkResult =
  | { success: true; relations: LlmFocusedRelativeLinkRelation[] }
  | { success: false; error: string }

/**
 * Orchestrates the Focused Relative-Link Analyzer call (Prototype 2.3O, production port of
 * the Prototype 2.3N spike's `runFocusedRelativeLink`): prompt -> LLM -> JSON parse -> Zod ->
 * (one repair attempt) -> result. Fully independent of GrammarAnalyzer, ReadingGuideAnalyzer,
 * PredicateStructureAnalyzer, and the Focused Complement/Subject-Verb analyzers — its own
 * prompt, its own schema, never shares a call with any of them (item 3/9).
 *
 * Returns the RAW (schema-valid but not yet source-grounded) relations — grounding and
 * mechanical sanity (item 11/12) are the caller's job (relativeLinkGrounding.ts), kept
 * separate so this module stays a pure LLM-orchestration layer, matching the shape of
 * FocusedComplementVerifier.ts/FocusedSubjectVerbRepairer.ts.
 *
 * Never throws for LLM-quality problems; always resolves to a Result.
 */
export async function analyzeFocusedRelativeLink(
  options: AnalyzeFocusedRelativeLinkOptions,
): Promise<AnalyzeFocusedRelativeLinkResult> {
  const { provider, model, sentence, temperature } = options

  const prompt = buildFocusedRelativeLinkPrompt(sentence)
  let generation = await provider.generateStructured({
    model,
    systemPrompt: prompt.system,
    userPrompt: prompt.user,
    jsonSchema: FOCUSED_RELATIVE_LINK_JSON_SCHEMA,
    temperature,
    callLabel: 'focused-relative-link.initial',
  })

  let attempt = validate(generation.rawText)

  for (let repairCount = 0; repairCount < MAX_REPAIR_ATTEMPTS && !attempt.success; repairCount++) {
    const repairPrompt = buildFocusedRelativeLinkRepairPrompt(sentence, generation.rawText, attempt.error)
    generation = await provider.generateStructured({
      model,
      systemPrompt: repairPrompt.system,
      userPrompt: repairPrompt.user,
      jsonSchema: FOCUSED_RELATIVE_LINK_JSON_SCHEMA,
      temperature,
      callLabel: `focused-relative-link.repair.${repairCount + 1}`,
    })
    attempt = validate(generation.rawText)
  }

  if (!attempt.success) {
    return { success: false, error: attempt.error }
  }

  return { success: true, relations: attempt.relations }
}

type ValidationOutcome = { success: true; relations: LlmFocusedRelativeLinkRelation[] } | { success: false; error: string }

function validate(rawText: string): ValidationOutcome {
  const parsed = tryParseJson(rawText)
  if ('error' in parsed) {
    return { success: false, error: `JSONとして解析できませんでした: ${parsed.error}` }
  }
  const result = llmFocusedRelativeLinkSchema.safeParse(parsed.value)
  if (!result.success) {
    return { success: false, error: result.error.issues.map((issue) => issue.message).join('; ') }
  }
  return { success: true, relations: result.data.relations }
}

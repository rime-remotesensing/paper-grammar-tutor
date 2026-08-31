import { MAX_REPAIR_ATTEMPTS } from '../../../config/settings.ts'
import { PREDICATE_STRUCTURE_JSON_SCHEMA } from '../schemas/predicateStructure.jsonSchema.ts'
import { llmPredicateStructureSchema, type PredicateStructure } from '../schemas/predicateStructure.schema.ts'
import type { LLMProvider } from '../../../llm/types.ts'
import {
  buildPredicateStructurePrompt,
  buildPredicateStructureRepairPrompt,
} from '../../../llm/prompts/predicateStructurePrompt.ts'
import { tryParseJson } from '../../../utils/jsonExtract.ts'
import { groundPredicateStructure } from './predicateStructureGrounding.ts'

export interface AnalyzePredicateStructureOptions {
  provider: LLMProvider
  model: string
  /** The exact text predicates/dependents/modifiers are grounded against — must be the
   * same text sentenceCore's own spans were resolved against (GrammarAnalysis.
   * normalizedText), or the hybrid merger's span arithmetic against sentenceCore breaks. */
  sentence: string
  temperature: number
}

export type AnalyzePredicateStructureResult =
  | { success: true; structure: PredicateStructure }
  | { success: false; error: string }

/**
 * Orchestrates the dedicated structure-only call (Prototype 2.3C, production port of the
 * Prototype 2.3A/2.3B spike's `analyzePredicateStructure`): prompt -> LLM -> JSON parse ->
 * Zod -> (one repair attempt) -> source grounding -> PredicateStructure. Fully independent
 * of GrammarAnalyzer and ReadingGuideAnalyzer — its own prompt, its own schema, never
 * shares a call with either, and only ever triggered alongside ReadingGuide by the same
 * "英語の語順で読む" click (see readingSupportOrchestrator.ts), never automatically.
 *
 * The raw PredicateStructure this returns is NOT shown to the user directly — it is
 * combined with the already-confirmed sentenceCore by hybridPredicateMerger.ts (a pure,
 * non-LLM function) before becoming the tree the UI renders (structureTree.ts).
 *
 * Never throws for LLM-quality problems; always resolves to a Result so a failure here can
 * fall back to the core-only tree (item 22) without disturbing ReadingGuide or the
 * already-displayed sentenceCore.
 */
export async function analyzePredicateStructure(
  options: AnalyzePredicateStructureOptions,
): Promise<AnalyzePredicateStructureResult> {
  const { provider, model, sentence, temperature } = options

  const prompt = buildPredicateStructurePrompt(sentence)
  let generation = await provider.generateStructured({
    model,
    systemPrompt: prompt.system,
    userPrompt: prompt.user,
    jsonSchema: PREDICATE_STRUCTURE_JSON_SCHEMA,
    temperature,
    callLabel: 'predicate-structure.initial',
  })

  let attempt = validate(generation.rawText, sentence)

  for (let repairCount = 0; repairCount < MAX_REPAIR_ATTEMPTS && !attempt.success; repairCount++) {
    const repairPrompt = buildPredicateStructureRepairPrompt(sentence, generation.rawText, attempt.error)
    generation = await provider.generateStructured({
      model,
      systemPrompt: repairPrompt.system,
      userPrompt: repairPrompt.user,
      jsonSchema: PREDICATE_STRUCTURE_JSON_SCHEMA,
      temperature,
      callLabel: `predicate-structure.repair.${repairCount + 1}`,
    })
    attempt = validate(generation.rawText, sentence)
  }

  if (!attempt.success) {
    return { success: false, error: attempt.error }
  }

  return { success: true, structure: attempt.structure }
}

type ValidationOutcome =
  | { success: true; structure: PredicateStructure }
  | { success: false; error: string }

function validate(rawText: string, sentence: string): ValidationOutcome {
  const parsed = tryParseJson(rawText)
  if ('error' in parsed) {
    return { success: false, error: `JSONとして解析できませんでした: ${parsed.error}` }
  }
  const result = llmPredicateStructureSchema.safeParse(parsed.value)
  if (!result.success) {
    return { success: false, error: formatZodIssues(result.error.issues) }
  }
  const grounded = groundPredicateStructure(result.data, sentence)
  if (!grounded.success) {
    return { success: false, error: grounded.error }
  }
  return { success: true, structure: grounded.structure }
}

function formatZodIssues(issues: ReadonlyArray<{ path: PropertyKey[]; message: string }>): string {
  return issues
    .map((issue) => {
      const path = issue.path.join('.')
      return path ? `${path}: ${issue.message}` : issue.message
    })
    .join('; ')
}

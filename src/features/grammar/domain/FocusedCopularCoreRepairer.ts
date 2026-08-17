import { MAX_REPAIR_ATTEMPTS } from '../../../config/settings.ts'
import { FOCUSED_COPULAR_CORE_REPAIR_JSON_SCHEMA } from '../schemas/focusedCopularCoreRepair.jsonSchema.ts'
import { llmFocusedCopularCoreRepairSchema } from '../schemas/focusedCopularCoreRepair.schema.ts'
import type { LLMProvider } from '../../../llm/types.ts'
import {
  buildFocusedCopularCoreRepairPrompt,
  buildFocusedCopularCoreRepairRepairPrompt,
} from '../../../llm/prompts/focusedCopularCoreRepairPrompt.ts'
import { tryParseJson } from '../../../utils/jsonExtract.ts'
import { resolveSpan } from '../../../utils/spanMatch.ts'
import type { Span } from '../schemas/grammarAnalysis.schema.ts'

export interface RepairFocusedCopularCoreOptions {
  provider: LLMProvider
  model: string
  sentence: string
  temperature: number
  /** Non-authoritative evidence only — see focusedCopularCoreRepairPrompt.ts's own doc
   * comment (Prototype 2.5V item 7 / 2.5W item 6: "no circular authority"). Not wired to a
   * live value in this phase — see docs/design-notes.md (Prototype 2.5W) for why the
   * Stage-2-divergence gate signal is validated-but-deferred. */
  stage2Hint?: string | null
}

export interface FocusedCopularCoreRepairResult {
  subject: Span
  verb: Span
  complement: Span
}

export type RepairFocusedCopularCoreOutcome =
  | { success: true; result: FocusedCopularCoreRepairResult }
  | { success: false; error: string }

/**
 * Orchestrates the Focused Copular Core Repair call (Prototype 2.5W, production port of
 * the Prototype 2.5V spike): prompt -> LLM -> JSON parse -> Zod -> source grounding ->
 * (one repair attempt, covering parse/schema/grounding failures alike) -> result. Fully
 * independent of GrammarAnalyzer/FocusedSubjectVerbRepairer/FocusedComplementVerifier/
 * PredicateStructureAnalyzer — its own prompt, its own schema, only ever invoked when
 * copularCoreGate.ts's gate fires (see analyzeSentenceWithComplementVerification.ts).
 *
 * Never throws for LLM-quality problems; always resolves to a Result so a repair failure
 * falls back to the existing raw core, same safe-failure philosophy as
 * FocusedSubjectVerbRepairer/FocusedComplementVerifier.
 */
export async function repairFocusedCopularCore(options: RepairFocusedCopularCoreOptions): Promise<RepairFocusedCopularCoreOutcome> {
  const { provider, model, sentence, temperature, stage2Hint = null } = options

  const prompt = buildFocusedCopularCoreRepairPrompt(sentence, stage2Hint)
  let generation = await provider.generateStructured({
    model,
    systemPrompt: prompt.system,
    userPrompt: prompt.user,
    jsonSchema: FOCUSED_COPULAR_CORE_REPAIR_JSON_SCHEMA,
    temperature,
  })

  let attempt = validate(generation.rawText, sentence)

  for (let repairCount = 0; repairCount < MAX_REPAIR_ATTEMPTS && !attempt.success; repairCount++) {
    const repairPrompt = buildFocusedCopularCoreRepairRepairPrompt(sentence, generation.rawText, attempt.error)
    generation = await provider.generateStructured({
      model,
      systemPrompt: repairPrompt.system,
      userPrompt: repairPrompt.user,
      jsonSchema: FOCUSED_COPULAR_CORE_REPAIR_JSON_SCHEMA,
      temperature,
    })
    attempt = validate(generation.rawText, sentence)
  }

  if (!attempt.success) {
    return { success: false, error: attempt.error }
  }

  return { success: true, result: attempt.result }
}

type ValidationOutcome = { success: true; result: FocusedCopularCoreRepairResult } | { success: false; error: string }

function validate(rawText: string, sentence: string): ValidationOutcome {
  const parsed = tryParseJson(rawText)
  if ('error' in parsed) {
    return { success: false, error: `JSONとして解析できませんでした: ${parsed.error}` }
  }
  const result = llmFocusedCopularCoreRepairSchema.safeParse(parsed.value)
  if (!result.success) {
    return { success: false, error: result.error.issues.map((issue) => issue.message).join('; ') }
  }

  const subject = resolveSpan(sentence, { text: result.data.subject, start: -1, end: -1 })
  const verb = resolveSpan(sentence, { text: result.data.verb, start: -1, end: -1 })
  const complement = resolveSpan(sentence, { text: result.data.complement, start: -1, end: -1 })
  if (!subject.resolved) return { success: false, error: `subject「${result.data.subject}」が原文中に見つかりませんでした。` }
  if (!verb.resolved) return { success: false, error: `verb「${result.data.verb}」が原文中に見つかりませんでした。` }
  if (!complement.resolved) return { success: false, error: `complement「${result.data.complement}」が原文中に見つかりませんでした。` }

  // Sensible source ordering (item 12): subject must precede verb, verb must precede (or at
  // least not start after) the complement — a genuinely primary-clause SVC shape, never an
  // inverted/nonsensical grounding.
  if (!(subject.start < verb.start && verb.start < complement.start)) {
    return { success: false, error: '文中の順序が不自然です（subject/verb/complementの並びを確認してください）。' }
  }

  return {
    success: true,
    result: {
      subject: { text: subject.text, start: subject.start, end: subject.end },
      verb: { text: verb.text, start: verb.start, end: verb.end },
      complement: { text: complement.text, start: complement.start, end: complement.end },
    },
  }
}

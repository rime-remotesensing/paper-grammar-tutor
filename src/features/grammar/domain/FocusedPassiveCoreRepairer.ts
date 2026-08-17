import { MAX_REPAIR_ATTEMPTS } from '../../../config/settings.ts'
import { FOCUSED_PASSIVE_CORE_REPAIR_JSON_SCHEMA } from '../schemas/focusedPassiveCoreRepair.jsonSchema.ts'
import { llmFocusedPassiveCoreRepairSchema } from '../schemas/focusedPassiveCoreRepair.schema.ts'
import type { LLMProvider } from '../../../llm/types.ts'
import {
  buildFocusedPassiveCoreRepairPrompt,
  buildFocusedPassiveCoreRepairRepairPrompt,
} from '../../../llm/prompts/focusedPassiveCoreRepairPrompt.ts'
import { tryParseJson } from '../../../utils/jsonExtract.ts'
import { resolveSpan } from '../../../utils/spanMatch.ts'
import type { Span } from '../schemas/grammarAnalysis.schema.ts'

export interface RepairFocusedPassiveCoreOptions {
  provider: LLMProvider
  model: string
  sentence: string
  temperature: number
  verbText: string
}

export type FocusedPassiveCoreRepairResult = { pattern: 'SV'; complement: null } | { pattern: 'SVC'; complement: Span }

export type RepairFocusedPassiveCoreOutcome =
  | { success: true; result: FocusedPassiveCoreRepairResult }
  | { success: false; error: string }

/**
 * Orchestrates the Focused Passive-Core Overcomplement Repair call (Prototype 2.5Z,
 * production port of the Prototype 2.5Y spike): prompt -> LLM -> JSON parse -> Zod ->
 * pattern/complement consistency validation -> source grounding (SVC only) -> (one repair
 * attempt) -> result. Fully independent of every other focused repair in this project — only
 * ever invoked when passiveCoreGate.ts's gate fires (see
 * analyzeSentenceWithComplementVerification.ts).
 *
 * Never throws for LLM-quality problems; always resolves to a Result so a repair failure
 * leaves the original core untouched (same safe-failure philosophy as every other focused
 * repairer in this project — item 19: never guess, never surface a technical error).
 */
export async function repairFocusedPassiveCore(options: RepairFocusedPassiveCoreOptions): Promise<RepairFocusedPassiveCoreOutcome> {
  const { provider, model, sentence, temperature, verbText } = options

  const prompt = buildFocusedPassiveCoreRepairPrompt(sentence, verbText)
  let generation = await provider.generateStructured({
    model,
    systemPrompt: prompt.system,
    userPrompt: prompt.user,
    jsonSchema: FOCUSED_PASSIVE_CORE_REPAIR_JSON_SCHEMA,
    temperature,
  })

  let attempt = validate(generation.rawText, sentence)

  for (let repairCount = 0; repairCount < MAX_REPAIR_ATTEMPTS && !attempt.success; repairCount++) {
    const repairPrompt = buildFocusedPassiveCoreRepairRepairPrompt(sentence, verbText, generation.rawText, attempt.error)
    generation = await provider.generateStructured({
      model,
      systemPrompt: repairPrompt.system,
      userPrompt: repairPrompt.user,
      jsonSchema: FOCUSED_PASSIVE_CORE_REPAIR_JSON_SCHEMA,
      temperature,
    })
    attempt = validate(generation.rawText, sentence)
  }

  if (!attempt.success) {
    return { success: false, error: attempt.error }
  }

  return { success: true, result: attempt.result }
}

type ValidationOutcome = { success: true; result: FocusedPassiveCoreRepairResult } | { success: false; error: string }

function validate(rawText: string, sentence: string): ValidationOutcome {
  const parsed = tryParseJson(rawText)
  if ('error' in parsed) {
    return { success: false, error: `JSONとして解析できませんでした: ${parsed.error}` }
  }
  const result = llmFocusedPassiveCoreRepairSchema.safeParse(parsed.value)
  if (!result.success) {
    return { success: false, error: result.error.issues.map((issue) => issue.message).join('; ') }
  }

  // Item 16: reject inconsistent pattern/complement combinations rather than guessing which
  // field to trust.
  if (result.data.pattern === 'SV') {
    if (result.data.complement !== null) {
      return { success: false, error: 'pattern="SV"の場合、complementはnullである必要があります。' }
    }
    return { success: true, result: { pattern: 'SV', complement: null } }
  }

  // pattern === 'SVC'
  if (result.data.complement === null) {
    return { success: false, error: 'pattern="SVC"の場合、complementはnullにできません。' }
  }
  const complementR = resolveSpan(sentence, { text: result.data.complement, start: -1, end: -1 })
  if (!complementR.resolved) {
    return { success: false, error: `complement「${result.data.complement}」が原文中に見つかりませんでした。` }
  }
  return { success: true, result: { pattern: 'SVC', complement: { text: complementR.text, start: complementR.start, end: complementR.end } } }
}

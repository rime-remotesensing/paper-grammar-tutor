import { MAX_REPAIR_ATTEMPTS } from '../../../config/settings.ts'
import { FOCUSED_WHERE_CLAUSE_REPAIR_JSON_SCHEMA } from '../schemas/focusedWhereClauseRepair.jsonSchema.ts'
import { llmFocusedWhereClauseRepairSchema } from '../schemas/focusedWhereClauseRepair.schema.ts'
import type { LLMProvider } from '../../../llm/types.ts'
import {
  buildFocusedWhereClauseRepairPrompt,
  buildFocusedWhereClauseRepairRepairPrompt,
} from '../../../llm/prompts/focusedWhereClauseRepairPrompt.ts'
import { tryParseJson } from '../../../utils/jsonExtract.ts'
import { resolveSpan } from '../../../utils/spanMatch.ts'
import type { Span } from '../schemas/grammarAnalysis.schema.ts'

export interface RepairFocusedWhereClauseOptions {
  provider: LLMProvider
  model: string
  sentence: string
  temperature: number
  /** The exact grounded span of the "where ..." clause as it currently sits in
   * sentenceModifiers — every returned child must ground WITHIN this span (item 37/38). */
  clauseSpan: Span
  /** Merger-ACCEPTED predicate candidates only (item 27/28) — never the raw Stage-2
   * predicate list, which may include a pseudo-predicate the merger will later reject. */
  acceptedPredicateCandidates: string[]
}

export interface FocusedWhereClauseRepairResult {
  /** null means the focused call could not find a safe, unambiguous owner (item 39) — the
   * caller must leave the clause exactly where it is, never guess. */
  owner: Span | null
  /** In source order, each fully contained within `clauseSpan` (item 37). */
  children: Span[]
}

export type RepairFocusedWhereClauseOutcome =
  | { success: true; result: FocusedWhereClauseRepairResult }
  | { success: false; error: string }

/**
 * Orchestrates the Focused Where-Clause Repair call (Prototype 2.5W, production port of the
 * Prototype 2.5V spike): prompt -> LLM -> JSON parse -> Zod -> owner/child validation ->
 * (one repair attempt) -> result. Fully independent of every other focused repair in this
 * project — only ever invoked when whereClauseGate.ts's gate fires (see
 * whereClauseRelocation.ts, the orchestration layer that applies a successful result BEFORE
 * mergeHybridPredicateStructure's own Step 5 — item 40).
 *
 * Never throws for LLM-quality problems; always resolves to a Result so a repair failure
 * leaves the original sentenceModifier untouched (item 38: "repair fails safely").
 */
export async function repairFocusedWhereClause(options: RepairFocusedWhereClauseOptions): Promise<RepairFocusedWhereClauseOutcome> {
  const { provider, model, sentence, temperature, clauseSpan, acceptedPredicateCandidates } = options

  const prompt = buildFocusedWhereClauseRepairPrompt(sentence, acceptedPredicateCandidates, clauseSpan.text)
  let generation = await provider.generateStructured({
    model,
    systemPrompt: prompt.system,
    userPrompt: prompt.user,
    jsonSchema: FOCUSED_WHERE_CLAUSE_REPAIR_JSON_SCHEMA,
    temperature,
  })

  let attempt = validate(generation.rawText, sentence, clauseSpan, acceptedPredicateCandidates)

  for (let repairCount = 0; repairCount < MAX_REPAIR_ATTEMPTS && !attempt.success; repairCount++) {
    const repairPrompt = buildFocusedWhereClauseRepairRepairPrompt(
      sentence,
      acceptedPredicateCandidates,
      clauseSpan.text,
      generation.rawText,
      attempt.error,
    )
    generation = await provider.generateStructured({
      model,
      systemPrompt: repairPrompt.system,
      userPrompt: repairPrompt.user,
      jsonSchema: FOCUSED_WHERE_CLAUSE_REPAIR_JSON_SCHEMA,
      temperature,
    })
    attempt = validate(generation.rawText, sentence, clauseSpan, acceptedPredicateCandidates)
  }

  if (!attempt.success) {
    return { success: false, error: attempt.error }
  }

  return { success: true, result: attempt.result }
}

type ValidationOutcome = { success: true; result: FocusedWhereClauseRepairResult } | { success: false; error: string }

function validate(rawText: string, sentence: string, clauseSpan: Span, acceptedPredicateCandidates: string[]): ValidationOutcome {
  const parsed = tryParseJson(rawText)
  if ('error' in parsed) {
    return { success: false, error: `JSONとして解析できませんでした: ${parsed.error}` }
  }

  // Prototype 2.5V finding: the model sometimes emits the STRING "null" rather than the
  // JSON literal when it means to abstain — normalize before Zod validation.
  const value = parsed.value
  if (typeof value === 'object' && value !== null && 'owner' in value && (value as { owner: unknown }).owner === 'null') {
    ;(value as { owner: unknown }).owner = null
  }

  const result = llmFocusedWhereClauseRepairSchema.safeParse(value)
  if (!result.success) {
    return { success: false, error: result.error.issues.map((issue) => issue.message).join('; ') }
  }

  // Item 36: owner must EXACTLY match one of the supplied accepted candidates. Anything
  // else (an invented/paraphrased predicate text) is treated as an abstain, not a hard
  // validation failure — a graceful degradation to "leave as sentenceModifier", the same
  // safe default as an explicit null, rather than wasting the one repair attempt on a
  // recoverable ambiguity signal.
  const ownerText = result.data.owner !== null && acceptedPredicateCandidates.includes(result.data.owner) ? result.data.owner : null

  let ownerSpan: Span | null = null
  if (ownerText !== null) {
    const ownerR = resolveSpan(sentence, { text: ownerText, start: -1, end: -1 })
    if (!ownerR.resolved) return { success: false, error: `owner「${ownerText}」が原文中に見つかりませんでした。` }
    ownerSpan = { text: ownerR.text, start: ownerR.start, end: ownerR.end }
  }

  // Item 37/38: every child must ground as an exact substring INSIDE the where-clause's own
  // span, in non-decreasing source order — never invented, never outside the clause, never
  // out of order.
  const children: Span[] = []
  let previousStart = -1
  for (const childText of result.data.children) {
    const childR = resolveSpan(sentence, { text: childText, start: -1, end: -1 })
    if (!childR.resolved) return { success: false, error: `child「${childText}」が原文中に見つかりませんでした。` }
    if (childR.start < clauseSpan.start || childR.end > clauseSpan.end) {
      return { success: false, error: `child「${childText}」がwhere節の範囲外です。` }
    }
    if (childR.start < previousStart) {
      return { success: false, error: `children の順序が原文の語順と一致しません。` }
    }
    previousStart = childR.start
    children.push({ text: childR.text, start: childR.start, end: childR.end })
  }

  return { success: true, result: { owner: ownerSpan, children } }
}

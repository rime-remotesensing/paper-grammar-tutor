import type { LLMProvider } from '../../../llm/types.ts'
import type { SentenceCore } from '../schemas/grammarAnalysis.schema.ts'
import type { PredicateStructure, ResolvedDependent } from '../schemas/predicateStructure.schema.ts'
import { classifyAcceptedPredicates } from './hybridPredicateMerger.ts'
import { evaluateWhereClauseGate } from './whereClauseGate.ts'
import { getFocusedWhereClauseRepair } from './focusedWhereClauseRepairService.ts'

export interface ApplyFocusedWhereClauseRepairOptions {
  provider: LLMProvider
  model: string
  temperature: number
  sentence: string
  sentenceCore: SentenceCore
  structure: PredicateStructure
}

export type WhereClauseRepairStatus =
  | 'not_applicable'
  | 'repaired'
  | 'abstained'
  | 'failed'

export interface ApplyFocusedWhereClauseRepairOutcome {
  structure: PredicateStructure
  status: WhereClauseRepairStatus
}

/**
 * Prototype 2.5W Part B orchestration — applies a successful Focused Where-Clause Repair
 * BEFORE mergeHybridPredicateStructure ever runs (item 40: "Timing is critical"), using the
 * SAME accepted-predicate authority (classifyAcceptedPredicates, item 28/29) the merger
 * itself will use moments later. This is exactly what avoids the 2.5V-discovered
 * flattening bug: by construction, the clause only ever attaches to a predicate that is
 * GUARANTEED to survive the merger's own Step 4, so 2.5S's rejected-candidate salvage can
 * never touch it.
 *
 * Called from AnalysisResultPanel.tsx right after getPredicateStructure resolves, before
 * `setStructure` — see that file's own integration comment. Never mutates `structure`; on
 * any non-repair outcome (gate didn't fire, focused call failed, or the model abstained),
 * returns the ORIGINAL structure completely unchanged (item 41: "remove exactly that
 * original where-clause sentenceModifier... on success" — never otherwise).
 */
export async function applyFocusedWhereClauseRepair(
  options: ApplyFocusedWhereClauseRepairOptions,
): Promise<ApplyFocusedWhereClauseRepairOutcome> {
  const { provider, model, temperature, sentence, sentenceCore, structure } = options

  const classification = classifyAcceptedPredicates(sentence, sentenceCore, structure.predicates)
  const gate = evaluateWhereClauseGate(structure, classification.accepted.length)
  if (!gate.fire || gate.candidateIndex === null) {
    return { structure, status: 'not_applicable' }
  }

  const clause = structure.sentenceModifiers[gate.candidateIndex]
  const acceptedPredicateCandidates = classification.accepted.map((p) => p.text)

  const repair = await getFocusedWhereClauseRepair({
    provider,
    model,
    temperature,
    originalText: sentence,
    clauseSpan: { text: clause.text, start: clause.start, end: clause.end },
    acceptedPredicateCandidates,
  })

  if (!repair.success) {
    return { structure, status: 'failed' }
  }
  if (repair.result.owner === null) {
    return { structure, status: 'abstained' }
  }

  // Item 42: never create a pseudo-predicate. Locate the EXISTING accepted candidate this
  // owner corresponds to (matched by text against the same accepted list the focused call
  // was given), then the exact structure.predicates entry it came from (matched by span) —
  // the clause only ever attaches to something already-real and already-surviving.
  const acceptedMatch = classification.accepted.find((p) => p.text === repair.result.owner!.text)
  if (!acceptedMatch) {
    return { structure, status: 'failed' }
  }
  const targetIndex = structure.predicates.findIndex((p) => p.start === acceptedMatch.start && p.end === acceptedMatch.end)
  if (targetIndex === -1) {
    return { structure, status: 'failed' }
  }

  const newDependent: ResolvedDependent = {
    text: clause.text,
    start: clause.start,
    end: clause.end,
    role: 'clause',
    children: repair.result.children.map((c) => ({ text: c.text, start: c.start, end: c.end, role: 'clause' as const })),
  }

  const newPredicates = structure.predicates.map((p, i) =>
    i === targetIndex ? { ...p, dependents: [...p.dependents, newDependent] } : p,
  )
  const newSentenceModifiers = structure.sentenceModifiers.filter((_, i) => i !== gate.candidateIndex)

  return {
    structure: { ...structure, predicates: newPredicates, sentenceModifiers: newSentenceModifiers },
    status: 'repaired',
  }
}

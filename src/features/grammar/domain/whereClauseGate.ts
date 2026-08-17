import type { PredicateStructure } from '../schemas/predicateStructure.schema.ts'

/**
 * Prototype 2.5W — production port of the Prototype 2.5V spike's where-clause candidacy
 * gate (item 31/32). Primary production scope is deliberately narrow: only a
 * sentence-level "where ..." modifier — never "which"/"when"/"while"/"because"/"although"
 * etc (item 32: the main GrammarAnalysis/PredicateStructure prompts' own completeness
 * guidance may still preserve those, but the focused owner+children repair targets only the
 * validated "where" shape this phase).
 */
const SUBORDINATOR = /^where\b/i

export interface WhereClauseGateResult {
  fire: boolean
  candidateIndex: number | null
  reason: string
}

/**
 * @param acceptedPredicateCount - the number of predicate candidates that would actually
 *   survive mergeHybridPredicateStructure's Steps 1–4 (via classifyAcceptedPredicates) —
 *   never the raw Stage-2 predicate count, which may include a doomed pseudo-predicate.
 */
export function evaluateWhereClauseGate(structure: PredicateStructure, acceptedPredicateCount: number): WhereClauseGateResult {
  if (acceptedPredicateCount === 0) {
    return { fire: false, candidateIndex: null, reason: 'no accepted predicate candidates to attach to' }
  }

  // Item 31/46-48: don't repair an already-healthy structure — if a "clause" dependent
  // somewhere already has more than one child, the raw model already decomposed it and
  // there is nothing to fix.
  const alreadyGoodElsewhere = structure.predicates.some((p) => p.dependents.some((d) => d.role === 'clause' && d.children.length > 1))
  if (alreadyGoodElsewhere) {
    return { fire: false, candidateIndex: null, reason: 'a clause dependent is already well-formed with children' }
  }

  const candidateIndex = structure.sentenceModifiers.findIndex((m) => m.role === 'clause' && SUBORDINATOR.test(m.text))
  if (candidateIndex === -1) {
    return { fire: false, candidateIndex: null, reason: 'no candidate "where ..." sentenceModifier' }
  }

  return { fire: true, candidateIndex, reason: 'candidate where-clause sentenceModifier found' }
}

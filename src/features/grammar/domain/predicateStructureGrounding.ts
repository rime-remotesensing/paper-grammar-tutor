import { resolveSpan } from '../../../utils/spanMatch.ts'
import type {
  LlmDependent,
  LlmLeaf,
  LlmPredicate,
  LlmPredicateStructure,
  PredicateStructure,
  ResolvedDependent,
  ResolvedLeaf,
  ResolvedPredicate,
} from '../schemas/predicateStructure.schema.ts'

export type GroundPredicateStructureResult =
  | { success: true; structure: PredicateStructure }
  | { success: false; error: string }

type GroundLeafResult = { success: true; node: ResolvedLeaf } | { success: false; error: string }
type GroundDependentResult = { success: true; node: ResolvedDependent } | { success: false; error: string }
type GroundPredicateResult = { success: true; node: ResolvedPredicate } | { success: false; error: string }

/**
 * Re-derives every span in the LLM's PredicateStructure response against `sentence` (never
 * trusts the model's own offsets, same rationale as resolveAnalysisSpans.ts /
 * readingGuideGrounding.ts). Ported from the Prototype 2.3A/2.3B spike's grounding.mjs,
 * unchanged in behavior — shape/enum validity is already guaranteed by
 * llmPredicateStructureSchema (Zod) before this runs, so this file's only job is source
 * grounding, same division of labor as GrammarAnalyzer's
 * resolveAnalysisSpans.ts.
 */
export function groundPredicateStructure(llm: LlmPredicateStructure, sentence: string): GroundPredicateStructureResult {
  const subjectModifiers: ResolvedLeaf[] = []
  for (const m of llm.subjectModifiers) {
    const g = groundLeaf(m, sentence)
    if (!g.success) return g
    subjectModifiers.push(g.node)
  }

  const sentenceModifiers: ResolvedLeaf[] = []
  for (const m of llm.sentenceModifiers) {
    const g = groundLeaf(m, sentence)
    if (!g.success) return g
    sentenceModifiers.push(g.node)
  }

  const predicates: ResolvedPredicate[] = []
  for (const p of llm.predicates) {
    const g = groundPredicate(p, sentence)
    if (!g.success) return g
    predicates.push(g.node)
  }

  return { success: true, structure: { subjectModifiers, predicates, sentenceModifiers } }
}

function groundLeaf(leaf: LlmLeaf, sentence: string): GroundLeafResult {
  const resolved = resolveSpan(sentence, { text: leaf.text, start: -1, end: -1 })
  if (!resolved.resolved) {
    return { success: false, error: `構造解析のnode「${leaf.text}」が原文中に見つかりませんでした。` }
  }
  return { success: true, node: { text: resolved.text, start: resolved.start, end: resolved.end, role: leaf.role } }
}

function groundDependent(dependent: LlmDependent, sentence: string): GroundDependentResult {
  const resolved = resolveSpan(sentence, { text: dependent.text, start: -1, end: -1 })
  if (!resolved.resolved) {
    return { success: false, error: `構造解析のdependent「${dependent.text}」が原文中に見つかりませんでした。` }
  }
  const children: ResolvedLeaf[] = []
  for (const child of dependent.children) {
    const grounded = groundLeaf(child, sentence)
    if (!grounded.success) return grounded
    children.push(grounded.node)
  }
  return {
    success: true,
    node: { text: resolved.text, start: resolved.start, end: resolved.end, role: dependent.role, children },
  }
}

function groundPredicate(predicate: LlmPredicate, sentence: string): GroundPredicateResult {
  const resolved = resolveSpan(sentence, { text: predicate.text, start: -1, end: -1 })
  if (!resolved.resolved) {
    return { success: false, error: `構造解析のpredicate「${predicate.text}」が原文中に見つかりませんでした。` }
  }
  const dependents: ResolvedDependent[] = []
  for (const dependent of predicate.dependents) {
    const grounded = groundDependent(dependent, sentence)
    if (!grounded.success) return grounded
    dependents.push(grounded.node)
  }
  return {
    success: true,
    node: { text: resolved.text, start: resolved.start, end: resolved.end, relation: predicate.relation, dependents },
  }
}

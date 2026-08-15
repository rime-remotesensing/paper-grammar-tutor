import { z } from 'zod'

/**
 * Prototype 2.3C: production port of the Prototype 2.3A/2.3B feasibility spike's
 * PredicateStructure concept. Independent from grammarAnalysis.schema.ts and
 * readingGuide.schema.ts — a third, separate LLM call whose ONLY job is the sentence's
 * predicate/coordination structure (subjectModifiers, predicates, their dependents,
 * sentenceModifiers). Never asked for readingSteps/expressions/vocabulary/advice/
 * translation (see predicateStructurePrompt.ts) — Prototype 2.3A's primary finding was
 * that isolating structure into its own single-purpose call handles true coordination
 * ("collected data AND analyzed the results", "were dried, weighed, AND stored") far more
 * reliably than GrammarAnalysis's single `verb` slot or a multi-purpose ReadingGuide call
 * ever did. See docs/design-notes.md.
 *
 * Fixed-depth (predicate -> dependent -> leaf, 3 levels), NOT a recursive/self-referential
 * schema — same discipline as grammarAnalysis.jsonSchema.ts / readingGuide.jsonSchema.ts's
 * fixed-depth structureBranches (now removed), and NO numeric parent/index reference
 * anywhere (Prototype 2.2A's failure mode, permanently avoided).
 *
 * The three fields the LLM returns carry no offsets — the app derives start/end itself
 * (see predicateStructureGrounding.ts) rather than trusting the model's own offsets, same
 * rationale as every other LLM-facing schema in this project.
 */

export const structureRoleSchema = z.enum(['object', 'complement', 'modifier', 'condition', 'range', 'clause', 'other'])
export type StructureRole = z.infer<typeof structureRoleSchema>

export const predicateRelationSchema = z.enum(['main', 'coordinated'])
export type PredicateRelation = z.infer<typeof predicateRelationSchema>

export const llmLeafSchema = z.object({
  text: z.string().min(1),
  role: structureRoleSchema,
})
export type LlmLeaf = z.infer<typeof llmLeafSchema>

export const llmDependentSchema = z.object({
  text: z.string().min(1),
  role: structureRoleSchema,
  children: z.array(llmLeafSchema),
})
export type LlmDependent = z.infer<typeof llmDependentSchema>

export const llmPredicateSchema = z.object({
  text: z.string().min(1),
  relation: predicateRelationSchema,
  dependents: z.array(llmDependentSchema),
})
export type LlmPredicate = z.infer<typeof llmPredicateSchema>

export const llmPredicateStructureSchema = z.object({
  subjectModifiers: z.array(llmLeafSchema),
  // A sentence always has at least one predicate — an empty array here is always a
  // real generation failure, never a legitimate "no predicate" sentence.
  predicates: z.array(llmPredicateSchema).min(1),
  sentenceModifiers: z.array(llmLeafSchema),
})
export type LlmPredicateStructure = z.infer<typeof llmPredicateStructureSchema>

/** Grounded leaf: a resolved Span plus its structural role. */
export interface ResolvedLeaf {
  text: string
  start: number
  end: number
  role: StructureRole
}

/** Grounded dependent: a resolved Span, its role, and its own (grounded) leaf children. */
export interface ResolvedDependent {
  text: string
  start: number
  end: number
  role: StructureRole
  children: ResolvedLeaf[]
}

/** Grounded predicate: a resolved Span, its relation to the sentence's main predicate,
 * and its own (grounded) dependents. */
export interface ResolvedPredicate {
  text: string
  start: number
  end: number
  relation: PredicateRelation
  dependents: ResolvedDependent[]
}

/** Final, grounded structure — input to hybridPredicateMerger.ts, never shown to the user
 * directly (the hybrid-merged result is what the UI renders; see structureTree.ts). */
export interface PredicateStructure {
  subjectModifiers: ResolvedLeaf[]
  predicates: ResolvedPredicate[]
  sentenceModifiers: ResolvedLeaf[]
}

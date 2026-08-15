import { z } from 'zod'

/**
 * Prototype 2.3O — production port of the Prototype 2.3N feasibility spike's Focused
 * Relative-Link Analyzer schema. A fourth, tiny, single-purpose LLM call: given only the
 * sentence text, find explicit relative clauses (that/which/who) and link each to its
 * antecedent — nothing else. No S/V/O/C, no supplement judgment, no translation, no
 * reading guide (item 3).
 *
 * Production scope is narrower than the 2.3N spike's schema (item 4/5/23): "whose"/"whom"
 * are DEFERRED (2.3N found "whose" antecedent detection unreliable — 0/20 exact — with the
 * failure mode always safe/missed, never a false link, but not yet accurate enough to ship);
 * "where"/"when"/"why" were already out of scope. The `function` field (SUBJECT/OBJECT/
 * POSSESSIVE) that existed in the spike schema is dropped entirely here (item 5) — 2.3N
 * measured it unreliable for "that" specifically (0/20 correct in two separate controls)
 * and it was never meant to be shown in the main UI regardless (item 23).
 */

export const relativeWordSchema = z.enum(['that', 'which', 'who'])
export type RelativeWord = z.infer<typeof relativeWordSchema>

export const llmFocusedRelativeLinkRelationSchema = z.object({
  antecedent: z.string().min(1),
  relativeWord: relativeWordSchema,
  relativeClause: z.string().min(1),
})
export type LlmFocusedRelativeLinkRelation = z.infer<typeof llmFocusedRelativeLinkRelationSchema>

export const llmFocusedRelativeLinkSchema = z.object({
  relations: z.array(llmFocusedRelativeLinkRelationSchema),
})
export type LlmFocusedRelativeLink = z.infer<typeof llmFocusedRelativeLinkSchema>

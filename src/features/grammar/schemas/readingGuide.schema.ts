import { z } from 'zod'

/**
 * Independent from grammarAnalysis.schema.ts — Reading Guide is a second, separate LLM
 * call (Prototype 2.1), not an extension of GrammarAnalysis. Deliberately small: readers
 * need left-to-right steps, useful multi-word expressions, how the pieces connect, and a
 * few reading strategy tips — not a second full grammatical breakdown.
 *
 * Prototype 2.3C: the pedagogical structure tree (main spine + coordinated predicates +
 * attachments) is no longer ReadingGuide's job at all. Prototype 2.2B/2.2C's
 * `structureBranches` field (a fixed-depth attachment tree the LLM produced alongside
 * readingSteps) is removed entirely — Prototype 2.3A/2.3B found that isolating structure
 * into its own dedicated, single-purpose LLM call (see predicateStructure.schema.ts)
 * combined with a deterministic hybrid merger (hybridPredicateMerger.ts) produces a far
 * more reliable tree than asking one multi-purpose call to do both reading-order chunking
 * AND structural attachment simultaneously (2.2C's own acceptance testing found this
 * tension: prompt changes that improved coordination handling measurably hurt the
 * already-working core-anchored tree, and vice versa). ReadingGuide goes back to being
 * purely what Prototype 2.1 originally built: a left-to-right reading aid, with no
 * dependency on sentenceCore at all (the old `attachTo` validation was the only reason
 * grounding ever needed sentenceCore as an input). See docs/design-notes.md.
 */

export const readingStepSchema = z.object({
  /** Exact substring of the sentence this step covers, verbatim, left-to-right. Never
   * trust the LLM's own claim at face value — see readingGuideGrounding.ts, which
   * re-resolves this against the real sentence the same way resolveAnalysisSpans.ts does
   * for GrammarAnalysis spans. Required non-empty: resolveSpan("", ...) would otherwise
   * "match" trivially at position 0 every time, which is unsafe. */
  text: z.string().min(1),
  /** Short Japanese question the reader should be asking at this point (e.g. "どうなった？").
   * Not required non-empty — qwen2.5:7b-instruct occasionally leaves this blank on a
   * step it has little to add for; an empty cue is a display nicety issue, not a
   * grounding/order safety issue, so it must not trigger a repair or drop the step
   * (dropping would leave a gap in the left-to-right walk). */
  cue: z.string(),
  /** 1-2 short Japanese sentences on what this chunk adds — never a full-sentence translation. */
  explanation: z.string(),
})
export type LlmReadingStep = z.infer<typeof readingStepSchema>

/** readingStepSchema plus the app-verified position within the sentence. */
export const resolvedReadingStepSchema = readingStepSchema.extend({
  start: z.number().int(),
  end: z.number().int(),
})
export type ResolvedReadingStep = z.infer<typeof resolvedReadingStepSchema>

export const connectionSchema = z.object({
  /** The phrase(s) this connection describes — a short label, not necessarily a single
   * exact substring (it may refer to how two separate phrases relate), so this is not
   * grounding-validated the way readingSteps/expressions are. Not required non-empty at
   * the schema level — readingGuideGrounding.ts drops any connection whose text or
   * explanation comes back blank, instead of failing the whole guide over it (qwen2.5:
   * 7b-instruct occasionally emits a placeholder connection entry with an empty field). */
  text: z.string(),
  /** Plain-Japanese explanation of how this fits with the rest of the sentence — not just
   * a grammar-term dump ("並列" alone is not enough; say what is parallel to what). */
  explanation: z.string(),
})
export type Connection = z.infer<typeof connectionSchema>

export const expressionSchema = z.object({
  /** Exact substring of the sentence — see readingGuideGrounding.ts. Entries that don't
   * resolve are dropped rather than shown, since a fabricated expression is worse than a
   * missing one. Required non-empty for the same resolveSpan("") safety reason as
   * readingStep.text. */
  text: z.string().min(1),
  /** The multi-word pattern name, e.g. "be + past participle", "every + number + unit",
   * "from A to B". Never a single word. Not required non-empty at the schema level —
   * readingGuideGrounding.ts drops any expression with a blank pattern/meaning/function
   * rather than failing the whole guide over one incomplete card. */
  pattern: z.string(),
  meaning: z.string(),
  function: z.string(),
})
export type LlmExpression = z.infer<typeof expressionSchema>

/** Expression plus the app-verified position in the normalized analysis sentence. */
export const resolvedExpressionSchema = expressionSchema.extend({
  start: z.number().int(),
  end: z.number().int(),
})
export type Expression = z.infer<typeof resolvedExpressionSchema>

/** What the LLM is asked to produce. readingSteps carry no offsets — the app derives
 * start/end itself (see resolvedReadingStepSchema) rather than trusting the model's. */
export const llmReadingGuideSchema = z.object({
  readingSteps: z.array(readingStepSchema).min(1),
  connections: z.array(connectionSchema),
  expressions: z.array(expressionSchema),
  // Not .min(1) per entry — a blank advice line is dropped in readingGuideGrounding.ts
  // rather than triggering a repair over what is ultimately a cosmetic issue.
  readingAdvice: z.array(z.string()),
})
export type LlmReadingGuide = z.infer<typeof llmReadingGuideSchema>

/** Final, grounded result shown in the UI. */
export interface ReadingGuide {
  readingSteps: ResolvedReadingStep[]
  connections: Connection[]
  expressions: Expression[]
  readingAdvice: string[]
}

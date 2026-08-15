import type { Expression } from '../schemas/readingGuide.schema.ts'

export interface GroupedExpression {
  pattern: string
  meaning: string
  function: string
  /** Distinct occurrences of this pattern in the sentence, in first-seen (source) order —
   * e.g. "every 1 nm" / "every 4 nm" both grouped under "every + number + unit". */
  examples: string[]
}

const DEFAULT_MAX_EXPRESSIONS = 4

/**
 * Turns the raw, grounded expression list into what the "文法・言い回し" section
 * actually shows (Prototype 2.2 items 12-15):
 * - drops single-word entries (e.g. a stray "nm" or "however") — expressions are for
 *   multi-word grammatical patterns, not vocabulary; single words belong in vocabulary
 *   or a readingStep instead.
 * - groups entries sharing the same `pattern` into one card with multiple `examples`,
 *   instead of showing "every 1 nm" and "every 4 nm" as two separate cards.
 * - caps the result at `maxCount`, keeping the first-seen (source-order) distinct
 *   patterns — deliberately no importance/relevance scoring, per item 15.
 */
export function prepareExpressionsForDisplay(
  expressions: readonly Expression[],
  maxCount: number = DEFAULT_MAX_EXPRESSIONS,
): GroupedExpression[] {
  const multiword = expressions.filter((e) => isMultiWord(e.text))

  const order: string[] = []
  const groups = new Map<string, GroupedExpression>()
  for (const expr of multiword) {
    const existing = groups.get(expr.pattern)
    if (existing) {
      if (!existing.examples.includes(expr.text)) existing.examples.push(expr.text)
      continue
    }
    groups.set(expr.pattern, { pattern: expr.pattern, meaning: expr.meaning, function: expr.function, examples: [expr.text] })
    order.push(expr.pattern)
  }

  return order.slice(0, maxCount).map((pattern) => groups.get(pattern)!)
}

function isMultiWord(text: string): boolean {
  return text.trim().split(/\s+/).filter(Boolean).length >= 2
}

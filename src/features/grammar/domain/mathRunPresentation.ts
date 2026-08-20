/**
 * Prototype 2.6G2.8M2.2a Track B — presentation-layer restoration/exclusion for the internal
 * "MATH_EXPR" analysis token (see mathRunProjection.ts). `MATH_EXPR` exists ONLY to protect
 * Stanza from structurally-unreliable relational/assignment expressions (item 6's own
 * requirement) — it must never appear in the Structure Tree, vocabulary panel, ReadingGuide/
 * expression panel, tooltips, or the selected-part reading panel.
 *
 * Two separate strategies, matching the two different needs (item 7/9):
 *  - RESTORE: a grounded span (Tree node text, a `Span`-shaped field) that CONTAINS a
 *    MATH_EXPR token gets that token replaced with the original MathRun's own source text,
 *    via `Projection.syntheticRunSourceRanges` -- position-based (`start`/`end` narrow down
 *    which global synthetic ranges are relevant to this exact node), never a page-wide text
 *    search. Within that narrowed set, the actual splice is a simple, safe, IN-ORDER literal
 *    "MATH_EXPR" replacement -- defensible specifically because MATH_EXPR is a controlled,
 *    internally-generated token no real source/LLM content could coincidentally produce
 *    (the same reasoning equationPlaceholder.ts's own literal-token restore already relies
 *    on), and the offset-narrowed range COUNT tells us exactly how many occurrences to
 *    expect inside this one node.
 *  - EXCLUDE: a vocabulary/ReadingGuide item whose ENTIRE grounded span falls inside one
 *    synthetic run is not a real word/expression at all -- it is dropped, never translated
 *    (item 9's own explicit requirement: exclusion, not restoration, for these two surfaces).
 */
import type { Span } from '../schemas/grammarAnalysis.schema.ts'
import type { StructureTreeNode } from './structureTree.ts'
import type { Projection } from './textProjection.ts'

const MATH_EXPR_TOKEN = 'MATH_EXPR'

/** True when [start, end) is entirely contained within one recorded synthetic math run --
 * i.e. this grounded span IS (or is fully inside) a MATH_EXPR placeholder, never real
 * source-grounded content. */
export function isFullySyntheticRange(start: number, end: number, projection: Projection): boolean {
  return (projection.syntheticRunSourceRanges ?? []).some((r) => start >= r.analysisStart && end <= r.analysisEnd)
}

/**
 * Restores literal "MATH_EXPR" occurrences within `text` (a slice of the analysis text
 * spanning [start, end)) to their original source text, using whichever
 * `Projection.syntheticRunSourceRanges` entries fall entirely within [start, end). Exported
 * for callers that only have a raw slice (e.g. `TreeReadingTarget.interactionText`, sliced
 * independently of any `StructureTreeNode`) rather than a whole tree to transform.
 */
export function restoreTextForRange(text: string, start: number, end: number, projection: Projection, sourceText: string): string {
  const overlapping = (projection.syntheticRunSourceRanges ?? [])
    .filter((r) => r.analysisStart >= start && r.analysisEnd <= end)
    .sort((a, b) => a.analysisStart - b.analysisStart)
  if (overlapping.length === 0 || !text.includes(MATH_EXPR_TOKEN)) return text
  let result = text
  for (const run of overlapping) {
    const idx = result.indexOf(MATH_EXPR_TOKEN)
    if (idx === -1) break // fewer literal occurrences left than expected ranges -- stop, never guess
    result = result.slice(0, idx) + sourceText.slice(run.sourceStart, run.sourceEnd) + result.slice(idx + MATH_EXPR_TOKEN.length)
  }
  return result
}

function restoreSpan<T extends Span>(span: T, projection: Projection, sourceText: string): T {
  const text = restoreTextForRange(span.text, span.start, span.end, projection, sourceText)
  return text === span.text ? span : { ...span, text }
}

/**
 * Recursively restores every text-bearing field of a Structure Tree (own `.text`,
 * `presentationSpan`, `connector`, `marker`, `antecedentSpan`, `sharedAuxiliarySpan`) so no
 * rendered node can ever show a literal "MATH_EXPR" -- applied ONCE, at the top of
 * AnalysisResultPanel, before the tree ever reaches StructureTreeView, so every existing
 * presentation/rendering code downstream (deriveStructureNodePresentation, NodeText,
 * coordination-group rendering, ...) needs no changes at all.
 */
export function restoreMathRunsInStructureTree(nodes: StructureTreeNode[], projection: Projection, sourceText: string): StructureTreeNode[] {
  if (!projection.syntheticRunSourceRanges || projection.syntheticRunSourceRanges.length === 0) return nodes
  return nodes.map((node) => {
    const text = restoreTextForRange(node.text, node.start, node.end, projection, sourceText)
    const presentationSpan = node.presentationSpan ? restoreSpan(node.presentationSpan, projection, sourceText) : node.presentationSpan
    const connector = node.connector ? restoreSpan(node.connector, projection, sourceText) : node.connector
    const marker = node.marker ? restoreSpan(node.marker, projection, sourceText) : node.marker
    const antecedentSpan = node.antecedentSpan ? restoreSpan(node.antecedentSpan, projection, sourceText) : node.antecedentSpan
    const sharedAuxiliarySpan = node.sharedAuxiliarySpan ? restoreSpan(node.sharedAuxiliarySpan, projection, sourceText) : node.sharedAuxiliarySpan
    const children = restoreMathRunsInStructureTree(node.children, projection, sourceText)
    return { ...node, text, presentationSpan, connector, marker, antecedentSpan, sharedAuxiliarySpan, children }
  })
}

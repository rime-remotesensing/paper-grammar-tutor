import type { StructureTreeNode } from './structureTree.ts'

/**
 * Prototype 2.5X Part A — presentation-only derivation of a concise display label for a
 * "clause"-role tree node whose grounded children already decompose its own full text (item
 * 12). NEVER mutates the domain tree: StructureTreeNode.text stays the full authoritative
 * grounded text always (item 10/11) — this is purely what NodeText (StructureTreeView.tsx)
 * shows instead of that full text when it would be visually redundant with the children
 * rendered directly beneath it.
 *
 * Generic, provenance-aware rule (item 12), not a hardcoded "where"/"which" check: the
 * structural prefix is whatever grounded text sits BEFORE the earliest child's own start
 * position, within the parent's own span. Deliberately narrow — only fires when the
 * earliest child's span is textually CONTAINED inside the parent's own text region (item
 * 14/26/27's negative controls): an ordinary dependent whose child adds a separate, later,
 * non-overlapping detail (e.g. a "range" child narrowing a "condition" dependent, per the
 * project's own long-standing Primary Reno example) never matches this and keeps its full
 * text untouched — this is what keeps item 15's "parent with children = hide text" blanket
 * rule forbidden while still fixing the specific clause-decomposition redundancy.
 */
export function deriveClauseDisplayLabel(node: StructureTreeNode): string {
  if (node.role !== 'clause' || node.children.length === 0) return node.text

  const earliestChild = [...node.children].sort((a, b) => a.start - b.start)[0]
  const nodeEnd = node.start + node.text.length

  // Item 14/27 safe fallback: the child must be grounded and textually inside the parent's
  // own span — otherwise this isn't "children decomposing the parent's own text" at all.
  if (earliestChild.start <= node.start || earliestChild.start >= nodeEnd) return node.text

  const prefix = node.text.slice(0, earliestChild.start - node.start).trim()

  // Item 14: empty or nonsensical (no actual word content) prefixes fall back to full text.
  if (prefix.length === 0 || !/[a-zA-Z]/.test(prefix)) return node.text

  return prefix
}

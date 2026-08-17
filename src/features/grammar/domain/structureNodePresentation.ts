import type { Span } from '../schemas/grammarAnalysis.schema.ts'
import type { StructureTreeNode } from './structureTree.ts'

export interface StructureNodePresentation {
  text: string
  start: number
  end: number
}

const DECOMPOSING_ROLES = new Set<StructureTreeNode['role']>(['modifier', 'condition'])

interface GroundedEvidence {
  text: string
  start: number
  end: number
}

function presentationOf(node: StructureTreeNode): StructureNodePresentation {
  return node.presentationSpan ?? { text: node.text, start: node.start, end: node.end }
}

/** True when every non-whitespace character in the authority text is owned by at least
 * one proposed visible span. Spans are already in the same normalized coordinate space. */
export function hasLosslessPresentationCoverage(
  authority: StructureNodePresentation,
  visibleSpans: ReadonlyArray<{ start: number; end: number }>,
): boolean {
  for (let offset = 0; offset < authority.text.length; offset++) {
    const sourcePosition = authority.start + offset
    if (/\s/.test(authority.text[offset])) continue
    if (!visibleSpans.some((span) => span.start <= sourcePosition && sourcePosition < span.end)) return false
  }
  return true
}

/**
 * Assigns a complement's otherwise-unowned suffix to its sole informative child only when
 * a suppressed grounded modifier crosses the complement's right boundary and begins after
 * that child with whitespace-only separation. The child keeps its authority fields; only
 * presentationSpan expands, clipped exactly to the parent authority (citation text beyond
 * it is never absorbed). Without that evidence, a lexical remainder triggers the lossless
 * fallback: hide the decomposition child and show the full parent.
 */
export function prepareLosslessComplementPresentation(
  node: StructureTreeNode,
  suppressedEvidence: readonly GroundedEvidence[],
): StructureTreeNode {
  const children = node.children.map((child) => prepareLosslessComplementPresentation(child, suppressedEvidence))
  const current = { ...node, children }
  if (current.role !== 'complement' || children.length !== 1) return current

  const [child] = children
  if (!DECOMPOSING_ROLES.has(child.role) || child.start <= current.start || child.end > current.end) return current
  if (presentationOf(child).end >= current.end) return current

  const support = suppressedEvidence.find((evidence) => {
    if (evidence.start < child.end || evidence.start >= current.end || evidence.end <= current.end) return false
    const gapStart = child.end - current.start
    const gapEnd = evidence.start - current.start
    return /^\s*$/.test(current.text.slice(gapStart, gapEnd))
  })
  if (!support) return { ...current, children: [] }

  const displayStart = child.start
  const displayEnd = current.end
  const text = current.text.slice(displayStart - current.start, displayEnd - current.start).trim()
  const presentationSpan: Span = { text, start: displayStart, end: displayEnd }
  return { ...current, children: [{ ...child, presentationSpan }] }
}

/**
 * Prototype 2.6B3: derives a non-overlapping visible label without changing the TreeNode's
 * authoritative text/span. Deliberately narrow: only one grounded modifier/condition child
 * decomposing a complement can shorten its parent's display to the source prefix before
 * that child. Multiple children are left unchanged rather than concatenating disjoint
 * remnants into unnatural English; coordination and non-complement nodes never enter this
 * path. All arithmetic is based on grounded offsets—no replace/startsWith/indexOf.
 */
export function deriveStructureNodePresentation(node: StructureTreeNode): StructureNodePresentation {
  const authority = presentationOf(node)
  if (node.presentationSpan) return authority
  if (node.role !== 'complement' || node.children.length !== 1) return authority

  const [child] = node.children
  if (!DECOMPOSING_ROLES.has(child.role)) return authority
  const childPresentation = presentationOf(child)
  if (childPresentation.start <= node.start || childPresentation.end > node.end) return authority

  const prefixLength = childPresentation.start - node.start
  const text = node.text.slice(0, prefixLength).trimEnd()
  if (text.length === 0 || !/[a-zA-Z]/.test(text)) return authority

  const parentPresentation = { text, start: node.start, end: node.start + text.length }
  if (!hasLosslessPresentationCoverage(authority, [parentPresentation, childPresentation])) return authority
  return parentPresentation
}

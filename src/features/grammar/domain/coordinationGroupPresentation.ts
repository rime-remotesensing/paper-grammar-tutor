import type { StructureTreeNode } from './structureTree.ts'

/**
 * Prototype 2.3D — PRESENTATION-ONLY visual coordination grouping. Does not add any new
 * semantic field to the domain tree (StructureTreeNode is untouched); this module only
 * decides, at render time, which already-existing sibling nodes should be visually
 * wrapped together with a shared background/border and a small connector badge (item 3).
 *
 * Deliberately does NOT import from hybridPredicateMerger.ts (item 17: no merger logic
 * changes this round) — CONNECTOR_MARKER below is an intentional, independent duplicate of
 * that file's private COORDINATION_MARKER constant, kept byte-for-byte in sync by hand.
 * Duplicating one small regex was judged safer than touching the frozen merger file for a
 * presentation-only phase.
 */

const CONNECTOR_MARKER = /\b(and|or|but|nor|yet)\b/i

function hasCoordinationEvidence(gapText: string): boolean {
  return CONNECTOR_MARKER.test(gapText) || gapText.includes(',')
}

function endOf(node: StructureTreeNode): number {
  return node.start + node.text.length
}

export interface CoordinationGroup {
  members: StructureTreeNode[]
  /** Literal connector word extracted from the source text between the group's members
   * (e.g. "and"/"or"/"but") — never invented (item 4/5). Null when no explicit
   * conjunction WORD appears in any gap (e.g. a pure comma-only chain), in which case the
   * UI shows the group without a word badge rather than fabricating one. */
  connectorText: string | null
}

/** Scans gaps from the LAST pair backward and returns the first explicit conjunction word
 * found — item 7/8: "the final explicit conjunction is the primary visual cue", not every
 * comma in a longer chain. */
function extractConnector(sentence: string, sortedMembers: StructureTreeNode[]): string | null {
  for (let i = sortedMembers.length - 1; i > 0; i--) {
    const gapStart = endOf(sortedMembers[i - 1])
    const gapEnd = sortedMembers[i].start
    if (gapEnd < gapStart) continue
    const match = CONNECTOR_MARKER.exec(sentence.slice(gapStart, gapEnd))
    if (match) return match[1]
  }
  return null
}

/**
 * Groups `candidates` into one CoordinationGroup IFF every adjacent pair (by source
 * position) has coordination evidence (and/or/but/nor/yet, or a comma) in the literal gap
 * text between them — the same conservative, deterministic check
 * hybridPredicateMerger.ts's coordination-evidence chain uses, re-derived here from source
 * text rather than trusting any upstream "this is a group" flag. Returns null (no group)
 * if fewer than 2 candidates, or if ANY adjacent gap lacks evidence — precision over
 * recall, matching item 10's "don't split/group when unsure" principle.
 */
export function detectCoordinationGroup(sentence: string, candidates: StructureTreeNode[]): CoordinationGroup | null {
  if (candidates.length < 2) return null
  const sorted = [...candidates].sort((a, b) => a.start - b.start)
  for (let i = 1; i < sorted.length; i++) {
    const gapStart = endOf(sorted[i - 1])
    const gapEnd = sorted[i].start
    if (gapEnd < gapStart) return null
    if (!hasCoordinationEvidence(sentence.slice(gapStart, gapEnd))) return null
  }
  return { members: sorted, connectorText: extractConnector(sentence, sorted) }
}

/** Main predicate + coordinated predicate(s) are always treated as one "family" for
 * grouping purposes (item 6) even though they carry different display roles
 * ('predicate' vs 'coordinatedPredicate') — every other role groups only with an
 * identical role (item 8's two "condition" dependents; never mixes e.g. a "modifier" with
 * a "condition" just because they happen to sit next to each other). */
function groupingKey(node: StructureTreeNode): string {
  return node.role === 'predicate' || node.role === 'coordinatedPredicate' ? 'predicateFamily' : node.role
}

export type SiblingRenderItem = { kind: 'group'; group: CoordinationGroup } | { kind: 'node'; node: StructureTreeNode }

/**
 * Walks one level of siblings (e.g. a subject node's children, or one predicate's
 * dependents) and partitions them into plain nodes and coordination groups. A "run" of 2+
 * adjacent (by source position) same-grouping-key siblings becomes a candidate group;
 * detectCoordinationGroup then re-validates it against the actual source text before it's
 * accepted. If evidence is missing anywhere in the run, every member of that run is
 * rendered as a plain (ungrouped) node instead — never a partial/guessed grouping.
 */
export function layoutSiblingsWithCoordinationGroups(sentence: string, siblings: StructureTreeNode[]): SiblingRenderItem[] {
  const sorted = [...siblings].sort((a, b) => a.start - b.start)
  const items: SiblingRenderItem[] = []
  let i = 0
  while (i < sorted.length) {
    let j = i + 1
    while (j < sorted.length && groupingKey(sorted[j]) === groupingKey(sorted[i])) j++
    const run = sorted.slice(i, j)
    const group = run.length >= 2 ? detectCoordinationGroup(sentence, run) : null
    if (group) {
      items.push({ kind: 'group', group })
    } else {
      for (const node of run) items.push({ kind: 'node', node })
    }
    i = j
  }
  return items
}

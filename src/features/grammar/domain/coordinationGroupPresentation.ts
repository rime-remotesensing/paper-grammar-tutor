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
   * UI shows the group without a word badge rather than fabricating one. Kept for backward
   * compatibility (it represents "the group's one overall/final connector", still the
   * right concept for coordinationListParser.ts's own separate single-node-text rendering
   * path) — box-level rendering of a StructureTreeView sibling group now uses
   * `boundaryConnectors` instead (Prototype 2.5ZA). */
  connectorText: string | null
  /** Prototype 2.5ZA (item 9/17): the connector immediately BEFORE each member, in member
   * order — same length as `members`, index 0 is always null (nothing precedes the first
   * member). For "A, B, and C" this is [null, null, "and"]: the outer connector belongs to
   * the B→C boundary, not the group as a whole. Derived the same way as `connectorText`
   * (scan the literal source gap between two consecutive members for an explicit
   * conjunction word) but WITHOUT stopping at the first hit — every boundary is inspected
   * independently, so a longer chain never collapses to "the last connector labels
   * everything". Never invented (item 14): a boundary with no explicit conjunction word in
   * its own gap is null, even if an earlier or later boundary has one. */
  boundaryConnectors: (string | null)[]
}

/** The literal explicit conjunction word (if any) in the gap between two specific,
 * consecutive members — the same per-boundary check `deriveBoundaryConnectors` and
 * `extractConnector` both build on. Returns null when the gap has no CONNECTOR_MARKER
 * match, without falling back to a comma or any other punctuation. */
function connectorInGap(sentence: string, before: StructureTreeNode, after: StructureTreeNode): string | null {
  const gapStart = endOf(before)
  const gapEnd = after.start
  if (gapEnd < gapStart) return null
  const match = CONNECTOR_MARKER.exec(sentence.slice(gapStart, gapEnd))
  return match ? match[1] : null
}

/** Scans gaps from the LAST pair backward and returns the first explicit conjunction word
 * found — item 7/8: "the final explicit conjunction is the primary visual cue", not every
 * comma in a longer chain. */
function extractConnector(sentence: string, sortedMembers: StructureTreeNode[]): string | null {
  for (let i = sortedMembers.length - 1; i > 0; i--) {
    const connector = connectorInGap(sentence, sortedMembers[i - 1], sortedMembers[i])
    if (connector) return connector
  }
  return null
}

/** Prototype 2.5ZA (item 9): the connector immediately before EACH member, independently —
 * unlike extractConnector, never stops early; a boundary with no explicit conjunction word
 * in its own literal gap is null regardless of what any other boundary has (item 5: nested
 * "and" tokens INSIDE one member's own text never leak into a neighboring boundary, since
 * each boundary only ever inspects the gap strictly BETWEEN two member spans). */
function deriveBoundaryConnectors(sentence: string, sortedMembers: StructureTreeNode[]): (string | null)[] {
  return sortedMembers.map((member, i) => (i === 0 ? null : connectorInGap(sentence, sortedMembers[i - 1], member)))
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
  return { members: sorted, connectorText: extractConnector(sentence, sorted), boundaryConnectors: deriveBoundaryConnectors(sentence, sorted) }
}

/** Main predicate + coordinated predicate(s) are always treated as one "family" for
 * grouping purposes (item 6) even though they carry different display roles
 * ('predicate' vs 'coordinatedPredicate') — every other role groups only with an
 * identical role (item 8's two "condition" dependents; never mixes e.g. a "modifier" with
 * a "condition" just because they happen to sit next to each other).
 *
 * Prototype 2.5S defensive guard (item 23): role "other" is the schema's catch-all for
 * content the model couldn't classify (e.g. an equation placeholder pushed to
 * sentenceModifiers) — it carries no real evidence that two such leftovers are actually
 * coordinated with each other, only that a connector word happens to sit in the source gap
 * between them (which may belong to unrelated surrounding structure, as with two equation
 * placeholders flanking a predicate-level "and"). Give every "other" node its own unique
 * key so it can never form a same-key run with another "other" node, regardless of gap
 * text — a real coordinated pair should already have been classified with a specific role
 * (object/clause/etc) upstream. This does not touch grouping for any other role. */
function groupingKey(node: StructureTreeNode): string {
  if (node.role === 'predicate' || node.role === 'coordinatedPredicate') return 'predicateFamily'
  // Prototype 2.6G2.6C5 (generalized from the earlier 2.6G2.6C4.2C rule, which only fired
  // for a 'subject'-role node that ITSELF carried `.connector` metadata): any 'subject'-role
  // node sharing a parent with another 'subject'-role node is, by construction, one branch of
  // a coordinated-CLAUSE presentation (stanzaStructureTree.ts's buildClauseNode is the only
  // place that ever produces 2+ 'subject'-role SIBLINGS -- an ordinary single clause has
  // exactly one subject, never a sibling to group against). Grouping every 'subject' node
  // into the same 'predicateFamily' key, unconditionally, lets `buildGroupFromConnectors`
  // find and render whichever branch actually carries `.connector` (the first/main branch
  // never does; a later coordinated-clause branch always does) without depending on an
  // implementation-detail guard that coupled this module's grouping decision to exactly how
  // many hops a connector had traveled. Never fires falsely elsewhere: 'subject' is not used
  // for canonical-constituent coordination members (those use 'coordinationMember') or
  // enumeration members (those use 'enumerationMember'), so this rule's scope stays narrow by
  // construction, not by an extra condition here.
  if (node.role === 'subject') return 'predicateFamily'
  if (node.role === 'other') return `other:${node.start}`
  return node.role
}

export type SiblingRenderItem = { kind: 'group'; group: CoordinationGroup } | { kind: 'node'; node: StructureTreeNode }

/**
 * Prototype 2.6G2.3 item 2/4 -- when EVERY non-first member of a same-grouping-key run
 * already carries its own structured `connector` metadata (set by the Stanza Tree builder
 * for predicate coordination, and now NP/object-internal coordination alike -- see
 * stanzaStructureTree.ts's buildCoordinationMemberNodes), that metadata is used DIRECTLY as
 * the group's own boundary connectors instead of re-deriving them from a second, independent
 * text-regex pass (`detectCoordinationGroup`'s own CONNECTOR_MARKER, which recognizes a
 * narrower word set than the structured `connectorSpan` the Tree builder itself already
 * used, and can disagree with it). This is what makes grouping RELIABLE for structured nodes
 * regardless of gap-text ambiguity, and is the single unified mechanism behind "member /
 * connector / member" for every coordination kind (predicate, object, NP, clause alike) --
 * never text-heuristic guessing when the authority already says these ARE coordinated.
 * Falls through to the legacy text-based detector when structured metadata isn't present
 * (every pre-2.6G2 Hybrid-tree node, and any structured run missing metadata somewhere).
 */
function buildGroupFromConnectors(run: StructureTreeNode[]): CoordinationGroup | null {
  if (run.length < 2) return null
  if (!run.slice(1).every((member) => member.connector)) return null
  const boundaryConnectors = run.map((member, i) => (i === 0 ? null : member.connector!.text))
  return { members: run, connectorText: run.at(-1)!.connector!.text, boundaryConnectors }
}

/**
 * Walks one level of siblings (e.g. a subject node's children, or one predicate's
 * dependents) and partitions them into plain nodes and coordination groups. A "run" of 2+
 * adjacent (by source position) same-grouping-key siblings becomes a candidate group;
 * structured `connector` metadata is used when every non-first member carries it (see
 * `buildGroupFromConnectors`), otherwise `detectCoordinationGroup` re-validates the run
 * against the actual source text before it's accepted. If evidence is missing anywhere in
 * the run, every member of that run is rendered as a plain (ungrouped) node instead — never
 * a partial/guessed grouping.
 */
export function layoutSiblingsWithCoordinationGroups(sentence: string, siblings: StructureTreeNode[]): SiblingRenderItem[] {
  const sorted = [...siblings].sort((a, b) => a.start - b.start)
  const items: SiblingRenderItem[] = []
  let i = 0
  while (i < sorted.length) {
    let j = i + 1
    while (j < sorted.length && groupingKey(sorted[j]) === groupingKey(sorted[i])) j++
    const run = sorted.slice(i, j)
    const group = run.length >= 2 ? (buildGroupFromConnectors(run) ?? detectCoordinationGroup(sentence, run)) : null
    if (group) {
      items.push({ kind: 'group', group })
    } else {
      for (const node of run) items.push({ kind: 'node', node })
    }
    i = j
  }
  return items
}

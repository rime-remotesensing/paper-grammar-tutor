import type { SentenceCore, Span } from '../schemas/grammarAnalysis.schema.ts'
import type { ResolvedLeaf } from '../schemas/predicateStructure.schema.ts'
import type { HybridDependent, HybridDependentRole, HybridLeaf, HybridMergedStructure, HybridPredicate } from './hybridPredicateMerger.ts'
import { parseRelativeClauseSuffix, startsWithRelativePronoun } from './relativeClausePresentation.ts'
import type { GroundedRelativeLinkRelation } from './relativeLinkGrounding.ts'
import { prepareLosslessComplementPresentation } from './structureNodePresentation.ts'

/** Role shown in the tree UI — the core-slot roles sentenceCore/hybridPredicateMerger own
 * (subject/predicate/coordinatedPredicate/indirectObject/object/complement) plus the
 * structure analyzer's own dependent/leaf roles (modifier/condition/range/clause/other),
 * plus three Prototype 2.3M presentation-only roles that never exist in the underlying
 * domain data (openingModifier/supplement/relativeClause) — see buildHybridStructureTree. */
export type StructureDisplayRole =
  | 'subject'
  | 'predicate'
  | 'coordinatedPredicate'
  | 'openingModifier'
  | 'supplement'
  | 'relativeClause'
  /** Prototype 2.6G2.1 -- a reduced/non-finite postmodifier clause (plain `acl`/`advcl`,
   * e.g. "called KNN-GCN", "collected by volunteers") that structurally postmodifies its
   * head but carries no relative pronoun -- distinct from a true `acl:relcl` relative
   * clause, which keeps the 'relativeClause' role above. */
  | 'postmodifier'
  /** Prototype 2.6G2 -- an explicit colon/semicolon-introduced list container (item 11 of
   * the Stanza Structure Tree migration). Never used for a canonical S/V/IO/O/C slot. */
  | 'enumeration'
  /** Prototype 2.6G2.5B2 -- a structural expletive/dummy pronoun (Stanza deprel `expl`,
   * e.g. "there" in "there is strong covariance...", "it" in "it seems that..."). A purely
   * functional placeholder that fills the syntactic subject position without being the
   * semantic subject -- never the canonical grammatical subject, never O/C, never an
   * `openingModifier` (it is not a genuine preposed adverbial). Distinguished from an
   * ordinary locative "there" (a genuine `advmod`/`obl` adverbial, e.g. "The book is
   * there.") purely by Stanza's own dependency role, never by matching the word itself. */
  | 'expletive'
  /** Prototype 2.6G2.6C (Generalized Tree Presentation Completion) item B/6/7 -- a member of
   * a coordination chain rooted directly at a CANONICAL slot's own head (subject/object/
   * indirectObject/complement), decomposed for presentation only. The canonical grammatical
   * role belongs to the slot's own container node (which keeps 'subject'/'object'/etc.
   * unchanged); a member is not independently "the subject" merely because it is one half of
   * a coordinated NP -- it never has its own separate clause-level grammatical role. Genuinely
   * distinct from a real embedded/subordinate/coordinated-predicate clause's own subject
   * (built via a plain `buildDecomposedConstituentNode('subject', ...)` call elsewhere in
   * stanzaStructureTree.ts, never through this coordination-member path), which correctly
   * keeps 'subject'. Never used for Problem A's internal/absorbed premodifier coordination
   * either (that path already uses the neutral 'modifier' role, unchanged). */
  | 'coordinationMember'
  /** Prototype 2.6G2.6C4.2B -- a member of an explicit colon/semicolon-introduced
   * `'enumeration'` list (see `buildEnumerationChildren` in stanzaStructureTree.ts).
   * Deliberately distinct from the generic `'other'` catch-all role: `'other'` marks content
   * the model/parser couldn't classify and carries no real evidence that two such leftovers
   * are actually coordinated with each other (coordinationGroupPresentation.ts's
   * `groupingKey` therefore gives every `'other'` node its own unique grouping key, so two
   * unrelated "other" leftovers never spuriously group). An enumeration member, by contrast,
   * DOES carry genuine dependency-parsed coordination evidence (a real `appos`/`conj` chain
   * under the list's own head) -- giving it its own role lets consecutive members share one
   * ordinary `groupingKey` and form a real coordination run, which is what lets the sibling-
   * level connector badge (`layoutSiblingsWithCoordinationGroups`) render the list's actual
   * `cc` connector (see each member's own `connector` field below) instead of silently
   * dropping it. */
  | 'enumerationMember'
  | HybridDependentRole

export interface StructureTreeNode {
  text: string
  role: StructureDisplayRole
  /** App-grounded span in the normalized analysis sentence. */
  start: number
  end: number
  children: StructureTreeNode[]
  /** Optional display/interaction ownership derived from grounded presentation evidence.
   * The node's own text/start/end remain its original grammatical authority. */
  presentationSpan?: Span
  /** Prototype 2.3O: index of the Focused Relative-Link relation this node belongs to,
   * stamped on BOTH the antecedent host and its relativeClause child by
   * applyFocusedRelativeLinks — lets multi-relation sentences (item 20/40) render each
   * antecedent<->relativeWord pair with a distinguishable marker. Undefined for every node
   * not produced by a Focused relation (including all of the 2.3M fallback's own nodes). */
  relationIndex?: number
  /** Prototype 2.6G2.2/2.6G2.3 -- the coordinating conjunction (and/but/or/...) that
   * introduces this node relative to its preceding sibling, as structured source-grounded
   * metadata rather than text baked into `text`/`presentationSpan`. This is the SOLE
   * authority for a coordinated node's connector; StructureTreeView's sibling-level
   * coordination-group renderer is the single place it is ever displayed (as its own
   * connector-badge row between members), so it is never shown twice and a coordinated
   * node's own text never repeats it. Undefined for a node with no connector (the ordinary
   * case, including every non-coordinated node and the legacy Hybrid-tree builder's own
   * predicate nodes, which never set this field). */
  connector?: Span
  /** Prototype 2.6G2.5B (restructured 2.6G2.5B3) -- a clause-introducing subordinating
   * conjunction/complementizer (if/because/although/when/while/whereas, or an infinitival
   * "to") captured as `ClauseFrame.marker`. Since 2.6G2.5B3 this is carried on a DEDICATED
   * wrapper node (role 'clause', `.text` equal to the marker word itself, single child =
   * the clause's real subject/predicate content -- see stanzaStructureTree.ts's
   * `wrapWithMarker`) rather than being stamped onto the subject/predicate node's own
   * text/role -- this keeps the marker structurally and visually separate from the
   * subject it introduces (never labelled as the subject, never fused into its text).
   * Undefined when the clause has no overt marker (a bare relative clause, a main clause,
   * or an asyndetic subordinate clause). */
  marker?: Span
  /** Prototype 2.6G2.6C2 (Structural Relative Antecedent Resolution) item 8/9 -- for a
   * `relativeClause` node only: the grounded source span of the NP/constituent this relative
   * clause postmodifies (its own raw `acl:relcl` dependency attachment target, per UD's own
   * definition of that deprel), independent of whether any OTHER node in the tree happens to
   * already represent that exact span. Presentation metadata only -- never touches
   * SentenceCoreSet, Stanza token heads, ClauseFrame parentage, or canonical Tree ownership.
   * Undefined when no antecedent could be reliably grounded (see
   * `groundRelativeClauseAntecedent` in stanzaStructureTree.ts) -- absence must never be
   * treated as "antecedent is the whole parent node" by any consumer. */
  antecedentSpan?: Span
  /** Prototype 2.6G2.6C6 (Shared Auxiliary Scope Presentation) -- for a `coordinatedPredicate`
   * node only: the grounded source span of the FIRST predicate's own auxiliary/passive-
   * auxiliary chain (e.g. "were" in "were collected", "has been" in "has been tested", "can
   * be" in "can be applied") when this coordinated predicate has no auxiliary of its own and
   * therefore grammatically inherits the first predicate's scope (see
   * `sharedAuxiliaryFor`/`findSharedAuxiliarySpan` in stanzaStructureTree.ts). This is
   * REFERENCE metadata to a real, already-grounded source span -- never a synthesized span,
   * never baked into this node's own `.text` (which stays exactly the coordinated predicate's
   * own verb text, e.g. "converted", satisfying the codebase-wide Span contract
   * unconditionally). Undefined for every ordinary node, including a coordinated predicate
   * that owns its own distinct auxiliary (e.g. "will" in "...and will write...") or has no
   * shareable auxiliary to inherit at all. */
  sharedAuxiliarySpan?: Span
}

/**
 * Prototype 2.3C: the pedagogical structure tree is now built in two possible ways,
 * depending on whether the dedicated structure call (PredicateStructureAnalyzer +
 * hybridPredicateMerger) succeeded:
 *
 * - buildCoreOnlyTree: sentenceCore ALONE, mechanically (S -> V -> O/C, no coordination
 *   awareness) — used as the fallback shown while structure is loading/failed (item 22),
 *   and is exactly what a structure-analyzer failure degrades to: the skeleton never
 *   disappears, only the extra detail does.
 * - buildHybridStructureTree: sentenceCore + the hybrid merger's result — the full tree,
 *   with coordinated predicates as siblings of the subject and every dependent/modifier
 *   the structure analyzer found, all grounded against the original source text.
 *
 * Neither builder trusts a numeric parent/index reference anywhere (Prototype 2.2A's
 * failure mode) — hybrid predicates/dependents/leaves only ever nest as literal children
 * in the object graph mergeHybridPredicateStructure already built.
 */
export function buildCoreOnlyTree(core: SentenceCore): StructureTreeNode[] {
  if (!core.subject || !core.verb) return []

  let verbChildren: StructureTreeNode[] = []
  if (core.pattern === 'SVOO' && core.indirectObject && core.object) {
    verbChildren = [
      { text: core.indirectObject.text, role: 'indirectObject', start: core.indirectObject.start, end: core.indirectObject.end, children: [] },
      { text: core.object.text, role: 'object', start: core.object.start, end: core.object.end, children: [] },
    ]
  } else if (core.pattern === 'SVOC' && core.object && core.complement) {
    verbChildren = [
      {
        text: core.object.text,
        role: 'object',
        start: core.object.start,
        end: core.object.end,
        children: [{ text: core.complement.text, role: 'complement', start: core.complement.start, end: core.complement.end, children: [] }],
      },
    ]
  } else if (core.object) {
    verbChildren = [{ text: core.object.text, role: 'object', start: core.object.start, end: core.object.end, children: [] }]
  } else if (core.complement) {
    verbChildren = [{ text: core.complement.text, role: 'complement', start: core.complement.start, end: core.complement.end, children: [] }]
  }

  const verbNode: StructureTreeNode = { text: core.verb.text, role: 'predicate', start: core.verb.start, end: core.verb.end, children: verbChildren }
  const subjectNode: StructureTreeNode = { text: core.subject.text, role: 'subject', start: core.subject.start, end: core.subject.end, children: [verbNode] }
  return [subjectNode]
}

function overlapsSpan(a: Span, b: { start: number; end: number }): boolean {
  if (a.start < 0 || b.start < 0) return false
  return Math.max(a.start, b.start) < Math.min(a.end, b.end)
}

/**
 * Main subject is sentenceCore's own span (authority — item 21 of Prototype 2.3C),
 * even though hybrid.subject is the same grounded span; using core directly keeps this
 * builder correct even if a future caller passes a hybrid result whose `subject` came out
 * null (e.g. sentenceCore.subject failed to ground) while core.subject itself is present.
 *
 * Prototype 2.3M reshapes this builder around three grammatical-authority rules the raw
 * PredicateStructure/Hybrid output cannot express on its own:
 *
 * 1. OPENING MODIFIER PLACEMENT (item 4/20): a subjectModifier whose span lies entirely
 *    BEFORE sentenceCore.subject (e.g. "In Section 3, we describe...") is mechanically NOT
 *    a subject-internal modifier — it is an opening element for the whole main clause.
 *    Diagnosed (Prototype 2.3M item 16, 20/20 runs): PredicateStructure always files this
 *    in subjectModifiers with role="clause" regardless, but its own grounded POSITION
 *    (end <= subject.start) is itself sufficient, already-available structural evidence —
 *    the exact same "pre-subject" geometry hybridPredicateMerger.ts already uses to
 *    exclude preposed predicate candidates (item 4/20's own recommended reuse). Rendered
 *    as a top-level sibling BEFORE the subject node, never nested under it.
 * 2. SUPPLEMENTARY -ING SEPARATION (item 5/21/22): when the Focused Complement Verifier
 *    (Prototype 2.3I) already confirmed a candidate complement is a supplementary -ing
 *    addition (`verifiedSupplementSpan`, passed by the caller only when
 *    verification.status === 'confirmed_supplementary_ing'), that authority OVERRIDES
 *    whatever role the raw Hybrid merger assigned the matching predicate — diagnosed
 *    (item 16, 20 runs) the merger's own comma-as-coordination-evidence rule (validated
 *    and correct for genuine "X did A, and did B" sentences) currently accepts this
 *    shape as a coordinated predicate 19/20 times, which would misleadingly render it as
 *    equal-weight to the true main predicate. The matching predicate is pulled OUT of the
 *    subject's predicate list entirely and rendered as its own top-level "supplement"
 *    block, positioned after the subject.
 * 3. RELATIVE CLAUSE DETECTION (item 7/8/11/19): see relativeClausePresentation.ts —
 *    conservative, presentation-only, requires either an already-separate grounded child
 *    node starting with a relative pronoun, or (for the subject specifically, since a
 *    relative clause modifying the subject is frequently folded entirely into
 *    sentenceCore.subject's own text with no separate PredicateStructure node at all —
 *    item 16 diagnosis) a same-node text split. Never fires for a bare content-clause
 *    "that" (item 15/18's negative control — verified empty/no-match against
 *    "The study showed that temperature increased."'s grounded object span).
 *
 * Prototype 2.3O item 24/25 adds a fourth, higher-priority authority on top of the three
 * above: validated Focused Relative-Link relations (`relations`, empty by default) override
 * whatever rule 3 above already produced for the SAME text region — see
 * applyFocusedRelativeLinks, run as a final pass over the tree this function would otherwise
 * return. Regions no relation covers are left exactly as rule 3 produced them (item 25:
 * "2.3M existing conservative structural relation — Focused resultなしの場合のみ").
 */
export function buildHybridStructureTree(
  core: SentenceCore,
  hybrid: HybridMergedStructure,
  verifiedSupplementSpan: Span | null = null,
  relations: GroundedRelativeLinkRelation[] = [],
): StructureTreeNode[] {
  if (!core.subject || !core.verb) return []

  // --- Rule 1: opening modifier placement ---
  const isOpening = (m: ResolvedLeaf) => m.end <= core.subject!.start
  const openingModifierNodes = sortByStart(
    hybrid.subjectModifiers.filter(isOpening).map((m) => ({ ...leafToNode(m), role: 'openingModifier' as const })),
  )
  const genuineSubjectModifierNodes = hybrid.subjectModifiers
    .filter((m) => !isOpening(m))
    .map(leafToNode)
    .map(relabelIfRelativeClauseModifier)

  // --- Rule 2: supplementary -ing separation ---
  const supplementPredicate = verifiedSupplementSpan
    ? hybrid.predicates.find((p) => overlapsSpan(verifiedSupplementSpan, p))
    : undefined
  const mainPredicates = hybrid.predicates.filter((p) => p !== supplementPredicate)
  const mainPredicateNodes = mainPredicates.map(predicateToNode).map(applyRelativeClauseToPredicateSubtree)

  // --- Rule 4 (Prototype 2.5X item 6/7/9): fold trailing sentenceModifiers into the SOLE
  // predicate ---
  // "sentenceModifiers" are phrases the structure analyzer could not tie to one specific
  // predicate (predicateStructurePrompt.ts's own definition) — genuinely ambiguous when 2+
  // predicates are coordinated (item 8: coordination stays the stronger authority, this rule
  // never fires then). With exactly ONE predicate, a modifier positioned AT OR AFTER that
  // predicate's own start is unambiguous by elimination (it can only belong to it) — but one
  // positioned BEFORE the predicate is a preposed sentence-level opener (e.g. "Although
  // temperatures increased, the sensor remained stable" — a live-diagnosed shape,
  // structureTree.test.ts's own regression fixture) and must stay a top-level sibling, never
  // folded under the predicate it precedes. Folded modifiers are merged with the predicate's
  // existing dependents and reordered by the SAME sortByStart already used for ordinary
  // dependents — this is what fixes CASE B's equation/where-clause visual ordering without
  // any new sorting logic and without a global sort: content salvaged from a rejected
  // coordination candidate (Prototype 2.5S) that would otherwise sit as a detached top-level
  // sibling of the subject, appearing after the subject's entire subtree in render order
  // regardless of its true source position, now renders as a true sibling of the predicate's
  // other dependents and sorts correctly among them.
  const soleMainPredicate = mainPredicates.length === 1 ? mainPredicates[0] : null
  const isFoldable = (m: ResolvedLeaf) => soleMainPredicate !== null && m.start >= soleMainPredicate.start
  const foldedSentenceModifiers = hybrid.sentenceModifiers.filter(isFoldable)
  const topLevelSentenceModifiers = hybrid.sentenceModifiers.filter((m) => !isFoldable(m))
  if (soleMainPredicate !== null && foldedSentenceModifiers.length > 0) {
    const foldedNodes = foldedSentenceModifiers.map(leafToNode).map(relabelIfRelativeClauseModifier)
    mainPredicateNodes[0] = { ...mainPredicateNodes[0], children: sortByStart([...mainPredicateNodes[0].children, ...foldedNodes]) }
  }

  const presentationEvidence = hybrid.suppressedOverlappingModifiers ?? []
  for (let i = 0; i < mainPredicateNodes.length; i++) {
    mainPredicateNodes[i] = prepareLosslessComplementPresentation(mainPredicateNodes[i], presentationEvidence)
  }

  // --- Rule 3 (subject-specific case): relative clause folded into the subject's own text ---
  const subjectSplit = parseRelativeClauseSuffix(core.subject.text)
  const subjectRelativeClauseChild: StructureTreeNode[] = subjectSplit
    ? [
        {
          text: subjectSplit.relativeClauseText,
          role: 'relativeClause',
          start: core.subject.start + subjectSplit.antecedentText.length + 1,
          end: core.subject.end,
          children: [],
        },
      ]
    : []

  const subjectNode: StructureTreeNode = {
    text: subjectSplit ? subjectSplit.antecedentText : core.subject.text,
    role: 'subject',
    start: core.subject.start,
    end: subjectSplit ? core.subject.start + subjectSplit.antecedentText.length : core.subject.end,
    children: sortByStart([...genuineSubjectModifierNodes, ...mainPredicateNodes, ...subjectRelativeClauseChild]),
  }

  const supplementNode: StructureTreeNode[] = supplementPredicate
    ? [{ ...applyRelativeClauseToPredicateSubtree(predicateToNode(supplementPredicate)), role: 'supplement' }]
    : []

  const sentenceModifierNodes = sortByStart(topLevelSentenceModifiers.map(leafToNode).map(relabelIfRelativeClauseModifier))

  const tree = [...openingModifierNodes, subjectNode, ...supplementNode, ...sentenceModifierNodes]
  return applyFocusedRelativeLinks(tree, relations)
}

function predicateToNode(predicate: HybridPredicate): StructureTreeNode {
  return {
    text: predicate.text,
    role: predicate.relation === 'main' ? 'predicate' : 'coordinatedPredicate',
    start: predicate.start,
    end: predicate.start + predicate.text.length,
    children: sortByStart(predicate.dependents.map(dependentToNode)),
  }
}

function dependentToNode(dependent: HybridDependent): StructureTreeNode {
  return {
    text: dependent.text,
    role: dependent.role,
    start: dependent.start,
    end: dependent.start + dependent.text.length,
    children: sortByStart(dependent.children.map(leafToNode)),
  }
}

function leafToNode(leaf: HybridLeaf | ResolvedLeaf): StructureTreeNode {
  const children = 'children' in leaf && leaf.children ? leaf.children.map(leafToNode) : []
  return {
    text: leaf.text,
    role: leaf.role,
    start: leaf.start,
    end: leaf.start + leaf.text.length,
    children: sortByStart(children),
  }

}

/** NP-like dependent roles that can plausibly be a relative-clause antecedent (item 19:
 * "structural relationship" half of the required pair). Deliberately narrow — a verb's own
 * clausal complement (role would never be 'object'/'indirectObject' on the CHILD that starts
 * with "that"; it sits as a direct, role-less dependent of the verb itself) never matches
 * this, which is exactly what keeps the content-that negative control (item 15/18/30) safe:
 * see the "showed [predicate] -> that temperature increased" shape, where the "that..." node
 * has no PRECEDING object/indirectObject sibling to attach to. */
const RELATIVE_CLAUSE_ANTECEDENT_ROLES = new Set<StructureDisplayRole>(['object', 'indirectObject'])

/**
 * For a leaf that can ONLY ever be an NP-modifying relative clause or a free clause-level
 * modifier — subjectModifiers, sentenceModifiers — never a verb's own clausal complement:
 * a bare "starts with relative pronoun" self-check on the node's own text is safe here
 * specifically because content-clause "that" (item 15) only ever attaches as a dependent of
 * the verb it complements ("showed THAT..."), never as a free-standing subject/sentence
 * modifier. Fixes the case where PredicateStructure grounds "that have changed since
 * Collection 5" as its own sentenceModifier leaf rather than nesting it under its antecedent
 * (Prototype 2.3M live diagnosis) — still flat (item 11's simplification allowance), but
 * correctly labeled and accent-marked instead of the wrong "条件".
 */
function relabelIfRelativeClauseModifier(node: StructureTreeNode): StructureTreeNode {
  if (node.role !== 'relativeClause' && startsWithRelativePronoun(node.text)) {
    return { ...node, role: 'relativeClause' }
  }
  return node
}

/**
 * Recursively applies relativeClausePresentation.ts's mechanisms to a predicate's own
 * dependent subtree (main predicate dependents, the supplement predicate's own subtree) —
 * NEVER the top-level subject node itself (handled separately in buildHybridStructureTree)
 * and never bare subjectModifiers/sentenceModifiers (see relabelIfRelativeClauseModifier
 * above — a different safety rule applies there). THREE mechanisms, all GATED on a
 * structural relationship to a plausible NP antecedent, never a bare "starts-with-pronoun"
 * check alone (item 15/19) — this distinction is what keeps a verb's own clausal complement
 * ("showed [predicate] -> that temperature increased", a direct, non-NP dependent of the
 * verb with no NP antecedent anywhere nearby) from ever being mislabeled a relative clause:
 * - a node whose OWN role is object/indirectObject may have its DIRECT children relabeled
 *   (the nesting itself, already grounded by PredicateStructure as `dependent.children`, IS
 *   the structural evidence — item 19; Prototype 2.3M live diagnosis's "clean" grounding
 *   shape, ~most common);
 * - a dependent immediately following an object/indirectObject SIBLING, itself starting
 *   with a relative pronoun, is re-parented as that sibling's own 'relativeClause' child
 *   instead of remaining a flat, mis-attributed sibling (Prototype 2.3M live diagnosis:
 *   PredicateStructure frequently grounds "those aspects" and "that have changed..." as flat
 *   siblings of the same predicate rather than nesting one inside the other — without this
 *   re-parenting, the antecedent-underline logic in StructureTreeView would incorrectly mark
 *   the PARENT predicate, not "those aspects", as the antecedent);
 * - a childless object/indirectObject dependent whose own text conservatively splits into
 *   antecedent + relative clause gets that split synthesized as a new child, never altering
 *   the node's original text as domain data (item 11's raw-text-unchanged guarantee — this
 *   only affects what StructureTreeView displays).
 */
function applyRelativeClauseToPredicateSubtree(node: StructureTreeNode): StructureTreeNode {
  const isAntecedentNode = RELATIVE_CLAUSE_ANTECEDENT_ROLES.has(node.role)
  let recursedChildren = node.children.map(applyRelativeClauseToPredicateSubtree)
  if (isAntecedentNode) {
    recursedChildren = recursedChildren.map((child) =>
      child.role !== 'relativeClause' && startsWithRelativePronoun(child.text) ? { ...child, role: 'relativeClause' } : child,
    )
  }

  const children: StructureTreeNode[] = []
  for (const child of recursedChildren) {
    const previous = children[children.length - 1]
    if (
      child.role !== 'relativeClause' &&
      previous !== undefined &&
      previous.children.length === 0 &&
      RELATIVE_CLAUSE_ANTECEDENT_ROLES.has(previous.role) &&
      startsWithRelativePronoun(child.text)
    ) {
      previous.children = [{ ...child, role: 'relativeClause' }]
      continue
    }
    children.push(child)
  }

  if (children.length === 0 && isAntecedentNode) {
    const split = parseRelativeClauseSuffix(node.text)
    if (split) {
      const relativeClauseNode: StructureTreeNode = {
        text: split.relativeClauseText,
        role: 'relativeClause',
        start: node.start + split.antecedentText.length + 1,
        end: node.end,
        children: [],
      }
      return { ...node, text: split.antecedentText, children: [relativeClauseNode] }
    }
  }

  return { ...node, children }
}

function nodeEnd(node: StructureTreeNode): number {
  return node.end
}

function spanContainedInNode(node: StructureTreeNode, span: Span): boolean {
  return node.start >= span.start && nodeEnd(node) <= span.end
}

/** Recursively removes any node whose OWN span is fully contained within `span` — used to
 * strip old/duplicate/partial representations of a relative clause (however the 2.3M
 * conservative heuristic or raw PredicateStructure happened to ground it: nested, flat
 * sibling, or fully detached sentenceModifier — Prototype 2.3M's live diagnosis found all
 * three) before the Focused relation's own exact span replaces it (item 45: presentation
 * duplicate suppression via span containment, never semantic fuzzy matching). Equality
 * counts as containment, so a pre-existing node that already happens to have the exact
 * right span is stripped and then re-added identically by the caller — a harmless no-op for
 * already-correct cases, and the actual fix for every other shape. */
function stripSpan(nodes: StructureTreeNode[], span: Span): StructureTreeNode[] {
  const kept: StructureTreeNode[] = []
  for (const node of nodes) {
    if (spanContainedInNode(node, span)) continue
    kept.push({ ...node, children: stripSpan(node.children, span) })
  }
  return kept
}

/** Finds the antecedent host for `antecedentSpan` anywhere in the tree by matching its
 * start position exactly. Returns null (relation left unapplied — item 44's conservative
 * default) when no node's span starts there at all; inventing a brand-new floating node
 * with no principled parent would be exactly the kind of ad-hoc heuristic Prototype
 * 2.3M/2.3N/2.3O have consistently avoided. A node whose text extends PAST the antecedent
 * (the "flat blob" shape, item 11's 2.3M allowance) is still a valid host — the caller
 * trims its displayed text down to the antecedent's own bounds. */
function findAntecedentHost(nodes: StructureTreeNode[], antecedentSpan: Span): StructureTreeNode | null {
  for (const node of nodes) {
    if (node.start === antecedentSpan.start) return node
    const found = findAntecedentHost(node.children, antecedentSpan)
    if (found) return found
  }
  return null
}

function replaceNode(nodes: StructureTreeNode[], target: StructureTreeNode, replacement: StructureTreeNode): StructureTreeNode[] {
  return nodes.map((node) => {
    if (node === target) return replacement
    return { ...node, children: replaceNode(node.children, target, replacement) }
  })
}

/**
 * Prototype 2.3O items 24/25/28/42-45: applies validated Focused Relative-Link relations as
 * the FIRST presentation authority for antecedent<->relative-clause linking, overriding
 * whatever the 2.3M conservative structural heuristic already produced for that same text
 * region. When no relation covers a given region, the 2.3M heuristic's result is left
 * completely untouched — that remains "authority 2", used only in the absence of a Focused
 * result (item 25).
 *
 * For each relation, in order: (1) strip any existing node fully contained within the
 * relation's relativeClauseSpan anywhere in the tree (item 45 dedup — also fixes the
 * "since Collection 5" truncated-span shape PredicateStructure alone produced in live
 * diagnosis, since the new node below uses the relation's OWN exact span instead, so "that"
 * can never disappear again — item 28/12); (2) locate the antecedent host node by exact
 * start-position match; (3) attach a brand-new relativeClause child built from the
 * relation's own exact source span, trimming the host's displayed text down to the
 * antecedent's own bounds (covers the "flat blob" shape uniformly — a no-op when the host's
 * text already matched exactly). A relation whose antecedent matches no node anywhere in the
 * tree is left unapplied (see findAntecedentHost). `relationIndex` is stamped on both the
 * host and the new child so multi-relation sentences (item 20/40) can render each pair with
 * a distinguishable marker without conflating one relation's antecedent with another's.
 */
export function applyFocusedRelativeLinks(
  nodes: StructureTreeNode[],
  relations: GroundedRelativeLinkRelation[],
): StructureTreeNode[] {
  let result = nodes
  relations.forEach((relation, index) => {
    result = stripSpan(result, relation.relativeClauseSpan)
    const host = findAntecedentHost(result, relation.antecedentSpan)
    if (!host) return

    const relativeClauseNode: StructureTreeNode = {
      text: relation.relativeClauseSpan.text,
      role: 'relativeClause',
      start: relation.relativeClauseSpan.start,
      end: relation.relativeClauseSpan.end,
      children: [],
      relationIndex: index,
    }
    const replacement: StructureTreeNode = {
      ...host,
      text: relation.antecedentSpan.text,
      end: relation.antecedentSpan.end,
      children: sortByStart([...host.children, relativeClauseNode]),
      relationIndex: index,
    }
    result = replaceNode(result, host, replacement)
  })
  return result
}

/** Keeps sibling order source-consistent when core-slot children and structure-analyzer
 * children are mixed under the same parent — purely a visual-stability sort, never
 * changes which node is whose parent. */
function sortByStart(nodes: StructureTreeNode[]): StructureTreeNode[] {
  return [...nodes].sort((a, b) => a.start - b.start)
}

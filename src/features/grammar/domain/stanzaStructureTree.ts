import type { Span } from '../schemas/grammarAnalysis.schema.ts'
import type { StructureTreeNode, StructureDisplayRole } from './structureTree.ts'
import {
  buildClauseFrames,
  buildPredicateFrame,
  childrenByHead,
  collectConstituentTokens,
  collectFullSubtree,
  connectorSpan,
  convertPredicateFrame,
  findPostnominalComplementToken,
  hasCommaBetween,
  isCitationLike,
  isPredicateLikeToken,
  normalizeDep,
  spanFromTokens,
  stripCitationTokens,
  type ClauseFrame,
  type PredicateFrame,
  type StanzaToken,
} from './stanzaSyntaxAuthority.ts'

/**
 * Prototype 2.6G2 / 2.6G2.1 -- production Stanza-hierarchical Structure Tree builder.
 *
 * Authority chain: Stanza -> ClauseFrame -> PredicateFrame -> SentenceCoreSet -> here.
 * This module NEVER re-derives S/V/IO/O/C itself -- every canonical slot value is taken
 * verbatim from stanzaSyntaxAuthority.ts's own `convertPredicateFrame`/constituent-selection
 * logic (imported, not re-implemented), so a Tree node can never contradict the Basic
 * Skeleton projection built from the exact same SentenceCoreSet.
 *
 * Prototype 2.6G2.1 (KNN-GCN live-control repair) replaces the earlier flat/leaf-only
 * modifier builder with a single recursive decomposition algorithm
 * (`buildDecomposedConstituentNode`) shared by every constituent this module builds --
 * canonical slots AND predicate modifiers alike. The same dependency shape (a restrictive
 * acl/advcl postmodifier, or an appos/conj enumeration list) is now decomposed identically
 * no matter whether the head token happens to be a canonical object or an ordinary oblique
 * modifier -- see the function's own doc comment for the four fixed projection gaps.
 *
 * `stanzaSyntaxAuthority.ts`'s own conversion functions (ClauseFrame/PredicateFrame
 * extraction, span selection) are frozen and untouched by this file.
 */

function node(role: StructureDisplayRole, span: Span, children: StructureTreeNode[] = [], connector?: Span): StructureTreeNode {
  return connector
    ? { text: span.text, role, start: span.start, end: span.end, children, connector }
    : { text: span.text, role, start: span.start, end: span.end, children }
}

function byStart(nodes: StructureTreeNode[]): StructureTreeNode[] {
  return [...nodes].sort((a, b) => a.start - b.start)
}

function isWithinAny(span: Span, consumedSpans: readonly Span[]): boolean {
  return consumedSpans.some((s) => span.start >= s.start && span.end <= s.end)
}

// ----------------------------------------------------------------------------
// Constituent decomposition: same acceptance rules as stanzaSyntaxAuthority.ts's
// collectConstituentTokens (restrictive vs. non-restrictive, citation/appos suppression,
// balanced delimiters via spanFromTokens), but building a small tree instead of one flat
// span -- a restrictive acl/acl:relcl postmodifier becomes its own child node instead of
// being flattened into the parent's text, and any appos/conj enumeration list owned by a
// token still visible in the parent's own core text is surfaced as an 'enumeration' child.
// ----------------------------------------------------------------------------

const POSTMODIFIER_CLAUSE_DEPS = new Set(['acl', 'advcl'])
const COPULAR_HEAD_STOP_DEPS: ReadonlySet<string> = new Set(['nsubj', 'csubj', 'cop'])
// `case` is included so a shared leading preposition ("of" in "a mixture of X and Y") stays
// with the coordination's own governing parent instead of being duplicated onto the first
// member -- the preposition semantically introduces the WHOLE coordinated NP, not just its
// first conjunct. Harmless for members with no case child of their own (the common case for
// every conjunct after the first).
const COORDINATION_MEMBER_STOP_DEPS: ReadonlySet<string> = new Set(['conj', 'cc', 'case'])

/**
 * Prototype 2.6G2.6C3 (Conservative Relative Scope) Part A item 3/5 -- a closed, small set of
 * English copula/auxiliary "be"/"have" surface forms, used ONLY as morphosyntactic EVIDENCE
 * for whether a relative clause's own predicate shows singular or plural agreement -- never
 * as an infallible semantic rule (a coordination can occasionally take collective/singular
 * agreement that doesn't map mechanically to "2+ members = plural"; this is acknowledged by
 * treating 'singular' as one input signal among several, not a standalone verdict).
 */
const SINGULAR_AGREEMENT_FORMS = new Set(['is', 'was', 'has'])
const PLURAL_AGREEMENT_FORMS = new Set(['are', 'were', 'have'])

/** Reads the relative clause's own cop/aux child (if any) for a recognizable singular/plural
 * surface form. Returns 'unknown' when the relative clause has no copula/aux at all, or uses
 * a form outside the small closed set above (e.g. a modal, or a bare lexical verb whose own
 * number marking this codebase has no reliable morphological feats to read) -- 'unknown' is
 * treated as NEUTRAL evidence, never as either positive or negative support. */
function relativeClauseAgreement(relclHead: StanzaToken, byHead: Map<number, StanzaToken[]>): 'singular' | 'plural' | 'unknown' {
  for (const child of byHead.get(relclHead.id) ?? []) {
    if (child.deprel !== 'cop' && child.deprel !== 'aux' && child.deprel !== 'aux:pass') continue
    const form = child.text.toLowerCase()
    if (SINGULAR_AGREEMENT_FORMS.has(form)) return 'singular'
    if (PLURAL_AGREEMENT_FORMS.has(form)) return 'plural'
  }
  return 'unknown'
}

/** Prototype 2.6G2.5B3 item 6 -- canonical S/O/C slot roles allowed to decompose a
 * dependency-backed coordination chain rooted AT their OWN head token (e.g. "VIF" conj
 * "PCC methods" both hanging directly off the subject's own head) into sibling
 * coordination-member children, while the node's own authority text/span (fullSpan below)
 * stays byte-identical to what SentenceCoreSet/collectConstituentTokens would produce --
 * B4 "authority != presentation" applied to canonical-slot-internal coordination, never
 * used for 'predicate' (predicate coordination is already handled at the clause-assembly
 * level via predicateHeadIds) or ordinary 'modifier' nodes (unchanged, matches the existing
 * nested-below-head coordination case just below). */
const CANONICAL_SLOT_ROLES: ReadonlySet<StructureDisplayRole> = new Set(['subject', 'object', 'indirectObject', 'complement'])

/** True when `token` is itself the HEAD of a `conj` coordination chain (has at least one
 * direct `conj` child) -- the dependency-structural signal (never lexical/text-based) that a
 * child of a constituent's own head should be split into sibling coordination-member nodes
 * instead of staying flattened into that constituent's own text (Prototype 2.6G2.3 item 3). */
function startsCoordinationChain(token: StanzaToken, byHead: Map<number, StanzaToken[]>): boolean {
  return (byHead.get(token.id) ?? []).some((c) => normalizeDep(c.deprel) === 'conj')
}

/** Walks the full `conj` chain reachable from `first`, robust to both the common "star"
 * pattern (every conjunct attaches directly to the first) and a chained/branching pattern
 * (each conjunct attaches to the previous one, or even to an earlier one non-linearly) --
 * the same stack-based traversal already proven for enumeration chains, generalized here to
 * ordinary NP/PP-internal coordination. Returned in source order. */
function collectConjChain(first: StanzaToken, byHead: Map<number, StanzaToken[]>): StanzaToken[] {
  const chain: StanzaToken[] = [first]
  const stack = [first]
  const seen = new Set([first.id])
  while (stack.length > 0) {
    const current = stack.pop()!
    for (const child of byHead.get(current.id) ?? []) {
      if (normalizeDep(child.deprel) === 'conj' && !seen.has(child.id)) {
        seen.add(child.id)
        chain.push(child)
        stack.push(child)
      }
    }
  }
  return [...chain].sort((a, b) => a.start - b.start)
}

/**
 * Builds sibling coordination-member nodes for an already-collected `chain` (Prototype
 * 2.6G2.3 item 3/4). Each member is itself fully decomposed via `buildDecomposedConstituentNode`
 * (so a member's OWN nested postmodifier/enumeration/further coordination structure is not
 * lost), and every member after the first carries `.connector` metadata derived the same way
 * predicate coordination already does -- the SAME structured mechanism, reused here so
 * rendering stays unified across predicate/object/NP/clause coordination alike (item 4's "one
 * convention" requirement) rather than inventing a second connector mechanism.
 */
function buildCoordinationMemberNodes(
  chain: StanzaToken[],
  byHead: Map<number, StanzaToken[]>,
  allTokens: StanzaToken[],
  boundaryIds: ReadonlySet<number>,
  sourceText: string,
  role: StructureDisplayRole,
): StructureTreeNode[] {
  let previousEnd = -1
  return chain.map((token, idx) => {
    const memberNode = buildDecomposedConstituentNode(role, token, byHead, allTokens, boundaryIds, sourceText, COORDINATION_MEMBER_STOP_DEPS)
    if (idx === 0) {
      previousEnd = memberNode.end
      return memberNode
    }
    const connector = connectorSpan(sourceText, previousEnd, memberNode.start)
    previousEnd = memberNode.end
    return connector ? { ...memberNode, connector } : memberNode
  })
}

/** True relative clause (`acl:relcl`, carries a relative pronoun/wh-word in the
 * overwhelming common case) vs. a reduced/non-finite postmodifier (plain `acl`, e.g.
 * "called KNN-GCN", "collected by volunteers" -- no relative pronoun). Stanza's own deprel
 * subtype already carries this distinction (also already read by stanzaSyntaxAuthority.ts's
 * own classifyClauseRelation for ClauseFrame.relation) -- this only decides which DISPLAY
 * role a postmodifier child gets; it invents no new grammatical fact. `advcl` never becomes
 * 'relativeClause' either way (an adverbial clause has no relative pronoun by definition). */
function postmodifierRoleFor(rawDeprel: string): StructureDisplayRole {
  return rawDeprel === 'acl:relcl' ? 'relativeClause' : 'postmodifier'
}

/**
 * Colon/semicolon-introduced lists that the canonical converter deliberately excludes from
 * predicate/object scope (see stanzaSyntaxAuthority.ts's bare-appos exclusion) are collected
 * here as ordered items rooted at `headId`'s own appos/conj children. Only ever called from
 * `buildDecomposedConstituentNode` below, on whichever token within a constituent's own core
 * text actually owns the list -- never a global sentence-wide scan (the enumeration stays
 * attached to the dependency constituent that owns it, wherever that constituent sits).
 */
/**
 * Prototype 2.6G2.6C4 Part A item 5/6 -- grounds one enumeration item's own span, stopping at
 * a `conj`/`cc` deprel at ANY depth (not just `head`'s own direct children). This is
 * deliberately NOT `collectConstituentTokens` (frozen authority): that function's own
 * `stopDeps` scoping is intentionally direct-children-only for canonical-slot grounding
 * elsewhere, but a genuine enumeration item can carry its OWN nested PP/NP modifier (e.g.
 * "the northern mountainous zone WITH STEEP SLOPES") whose own head, several hops down, is
 * where the NEXT list member's `conj` actually attaches (UD's own convention only guarantees
 * "attaches somewhere within the preceding conjunct", not "attaches to that conjunct's own
 * top token") -- using the direct-children-only stop here silently absorbed the whole next
 * item into this one's own span, live-diagnosed via "...into two zones: the northern
 * mountainous zone with steep slopes and the southern coastal plain..." (0 items ever found,
 * full colon-list content dropped, since "plain" is `conj` of "slopes" -- `nmod`, itself a
 * direct child of "zone" -- never of "zone" directly). Any `conj` found at any depth is
 * excluded from THIS item's own span and returned separately as the next item's own root,
 * whatever depth it was found at -- general and dependency-structural, never keyed to a
 * specific nesting depth or lexical pattern.
 */
// A `conj` reached through one of these deprels (a genuine, "loosely" attached PP/NP modifier
// -- the item's head is modified BY a separate phrase, not fused into one compact unit with
// it) is trusted as a potential list continuation. A `conj` reached only through a "tight"
// premodifier deprel (compound/amod/det/nummod/case -- integrated into the SAME compact
// nominal as the item's own head, e.g. a multi-word compound noun) is never trusted this way:
// live-diagnosed via "bh24-long-80-plus", where Stanza mis-tags a genuinely coordinated VERB
// ("flags", "estimates") as a plain compound-noun premodifier chain -- without this
// restriction, "estimates" (reached only via "flags", a `compound` child of "readings") was
// wrongly treated as a legitimate next list item, reviving a cross-type ownership duplication
// this codebase already fixed once for the SAME sentence via a different mechanism.
//
// Prototype 2.6G2.6C4.2A -- `appos` was REMOVED from this set. `appos` is structurally
// overloaded: the SAME deprel marks both (a) a genuine nested apposition inside one item
// (e.g. "a digital elevation model (DEM)") and (b) a trailing citation appositive attached to
// that SAME item's own head (e.g. "trigger factors (Mandal et al. 2021)" -- "Mandal" is
// `appos` of the FIRST list item's own head token). Live-diagnosed via the exact production
// control "...causative factors and trigger factors (Mandal et al. 2021)": treating `appos`
// as a loose gateway let "al." (`conj` of the citation's own "Mandal" token, itself only
// reachable through that `appos`) get harvested as a bogus THIRD list item. `appos` is never
// trusted as a next-item gateway now, for either citation or non-citation content -- see the
// dedicated, independent citation check for `appos` children in the main walk below instead,
// which handles genuine vs. citation apposition on its own terms.
const LOOSE_ENUMERATION_MODIFIER_DEPS = new Set(['nmod', 'obl'])

function collectEnumerationItemSubtree(
  head: StanzaToken,
  byHead: Map<number, StanzaToken[]>,
  text: string,
): { tokens: StanzaToken[]; nextConjunctRoots: StanzaToken[]; droppedCitationIds: Set<number> } {
  const tokens: StanzaToken[] = []
  const nextConjunctRoots: StanzaToken[] = []
  // Prototype 2.6G2.6C4.3A -- every token in a subtree excluded here specifically BECAUSE it
  // was judged citation-like (never a punct/conj/cc glue token, which is excluded for an
  // unrelated structural reason) is recorded so a caller can later verify "this range's
  // content is fully EXPLAINED (visible member content, or a deliberately-dropped citation),
  // never silently missing" without re-deriving the citation classification a second time.
  const droppedCitationIds = new Set<number>()
  const stack: { token: StanzaToken; throughLooseAttachment: boolean }[] = [{ token: head, throughLooseAttachment: true }]
  const seen = new Set<number>()
  while (stack.length > 0) {
    const { token: current, throughLooseAttachment } = stack.pop()!
    if (seen.has(current.id)) continue
    seen.add(current.id)
    tokens.push(current)
    for (const child of byHead.get(current.id) ?? []) {
      const dep = normalizeDep(child.deprel)
      if (dep === 'punct') continue
      if (dep === 'conj' || dep === 'cc') {
        if (dep === 'conj' && throughLooseAttachment && !isPredicateLikeToken(child, byHead)) nextConjunctRoots.push(child)
        continue // never absorbed into this item's own span, at any depth
      }
      if (dep === 'appos') {
        // Prototype 2.6G2.6C4.2A -- independently ground THIS appositive's own full subtree
        // (walked separately, following its own conj chain too, e.g. "Mandal" + "et" + "al."
        // + "2021" together) and test citation-likeness on that NARROW span alone -- never on
        // the parent item's already-collected (and therefore potentially much larger, diluted)
        // span. A citation-like appositive subtree is excluded ENTIRELY: never absorbed into
        // this item's own tokens, and never explored further (so its own `conj`/nested
        // structure -- "al." -- can never leak out as a bogus sibling list item either). A
        // non-citation appositive (e.g. "(DEM)", a defining parenthetical abbreviation) is
        // absorbed exactly as before, just never itself a gateway for further list-item
        // harvesting (matching the general "appos is never a loose gateway" policy above).
        const apposSubtree = collectFullSubtree(child, byHead)
        const apposSpan = spanFromTokens(text, apposSubtree)
        if (apposSpan && isCitationLike(apposSpan)) {
          for (const t of apposSubtree) droppedCitationIds.add(t.id)
          continue
        }
        stack.push({ token: child, throughLooseAttachment: false })
        continue
      }
      // Prototype 2.6G2.6C4.3 -- a citation does not always attach via `appos`: Stanza's own
      // catch-all `dep` deprel is a live-confirmed alternate attachment point for the exact
      // same "Name et al. Year" shape (matching stanzaSyntaxAuthority.ts's own citation
      // fixtures, which use `dep` for this reason). Applying the SAME narrow, subtree-local
      // citation check to every remaining child (not just `appos`) generalizes the exclusion
      // instead of leaving this one deprel a gap: without it, a `dep`-attached citation gets
      // unconditionally absorbed into the item's own span, making the item's WHOLE combined
      // text match `isCitationLike` and get nulled entirely by the caller's own final safety
      // net -- silently deleting genuine content ("satellite imagery") alongside the citation,
      // exactly the whole-subtree-over-stripping class 2.6G2.5C4 already fixed at the
      // authority layer. A non-citation child (the overwhelming majority) is completely
      // unaffected -- this only ever excludes a subtree whose OWN narrow span is citation-like.
      const childSubtree = collectFullSubtree(child, byHead)
      const childSpan = spanFromTokens(text, childSubtree)
      if (childSpan && isCitationLike(childSpan)) {
        for (const t of childSubtree) droppedCitationIds.add(t.id)
        continue
      }
      stack.push({ token: child, throughLooseAttachment: LOOSE_ENUMERATION_MODIFIER_DEPS.has(dep) })
    }
  }
  return { tokens, nextConjunctRoots, droppedCitationIds }
}

/** Prototype 2.6G2.6C4.2B -- the real `cc` connector (if any) that structurally introduces
 * `conjToken` as a coordinated member. This project's own Stanza server consistently attaches
 * a `cc` token as a DIRECT CHILD of the `conj` token it introduces (the same shape already
 * relied on elsewhere for the "Name et al. Year" citation pattern: "et" -> head "al." -- see
 * stanzaSyntaxAuthority.ts), never assumed from word identity: any deprel-`cc` child qualifies
 * (and/or/but/nor/yet/...), generalized over the whole coordinating-conjunction word class.
 * Returns undefined when no `cc` child exists (a pure comma-only boundary), never inventing
 * one. */
function findConjunctionConnector(conjToken: StanzaToken, byHead: Map<number, StanzaToken[]>, text: string): Span | undefined {
  const ccChild = (byHead.get(conjToken.id) ?? []).find((c) => normalizeDep(c.deprel) === 'cc')
  if (!ccChild) return undefined
  return spanFromTokens(text, [ccChild]) ?? undefined
}

/** Prototype 2.6G2.6C4.3 -- factored out of `buildEnumerationChildren` so the same item-
 * grounding logic (span, citation exclusion, connector lookup) can be reused for a supplement
 * list's own members (2.6G2.6C4.3), not just a colon/semicolon enumeration's direct appos/conj
 * children. `isFollowingMember` matches the established convention: only a following member
 * (never the list's own first-discovered member) can legitimately carry a connector.
 * Returns null when `itemHead` is predicate-like (UD coordination-attachment-drift, never a
 * genuine list member -- see the caller's own doc comment) or citation-only (nothing else to
 * preserve). */
function buildOneEnumerationItem(
  itemHead: StanzaToken,
  isFollowingMember: boolean,
  byHead: Map<number, StanzaToken[]>,
  text: string,
  excludeTokenId?: number,
): { itemNode: StructureTreeNode; nextConjunctRoots: StanzaToken[]; tokenIds: Set<number>; droppedCitationIds: Set<number> } | null {
  if (isPredicateLikeToken(itemHead, byHead)) return null
  const { tokens: rawSubtree, nextConjunctRoots, droppedCitationIds } = collectEnumerationItemSubtree(itemHead, byHead, text)
  // Prototype 2.6G2.6C4.3: `excludeTokenId` lets a caller strip its OWN already-separately-
  // presented token (e.g. a supplement's own `case` marker, "including", shown via `.marker`
  // on the container) out of this item's absorbed span -- never a general exclusion, since an
  // ordinary colon-enumeration item's own `case` child (e.g. a genuine "on Monday" list item)
  // legitimately stays part of that item's own text.
  const subtree = excludeTokenId === undefined ? rawSubtree : rawSubtree.filter((t) => t.id !== excludeTokenId)
  const span = spanFromTokens(text, subtree)
  if (!span || isCitationLike(span)) return null
  const dep = normalizeDep(itemHead.deprel)
  const connector = isFollowingMember && dep === 'conj' ? findConjunctionConnector(itemHead, byHead, text) : undefined
  const tokenIds = new Set(subtree.map((t) => t.id))
  return { itemNode: node('enumerationMember', span, [], connector), nextConjunctRoots, tokenIds, droppedCitationIds }
}

function buildEnumerationChildren(headId: number, byHead: Map<number, StanzaToken[]>, text: string): StructureTreeNode[] {
  const items: StructureTreeNode[] = []
  // Prototype 2.6G2.6C4.2B: each stack entry tracks whether it was reached as a FOLLOWING
  // member of an already-discovered item (`nextConjunctRoots`, pushed below) rather than as
  // one of the enumeration head's own initial direct children -- only a following member can
  // legitimately carry a connector representing "the boundary immediately before it"; the
  // list's own first-discovered member never does, matching the same convention
  // coordinationGroupPresentation.ts's `boundaryConnectors` already documents (index 0 always
  // null).
  const stack: { token: StanzaToken; isFollowingMember: boolean }[] = (byHead.get(headId) ?? []).map((token) => ({ token, isFollowingMember: false }))
  while (stack.length > 0) {
    const { token: child, isFollowingMember } = stack.pop()!
    const dep = normalizeDep(child.deprel)
    if (dep !== 'conj' && dep !== 'appos') continue
    // Prototype 2.6G2.6C (Generalized Tree Presentation Completion) Problem E: a
    // predicate-like conj/appos child (`isPredicateLikeToken`, the same frozen-authority
    // verb/finite-clause-head signal the coordination-member block already gates on) is
    // never a genuine enumeration LIST MEMBER -- it is UD coordination-attachment-drift, a
    // separately-owned clause's own verb mis-attached to this constituent's head. Treating
    // it as a list item built a bogus 'enumeration' wrapper around a completely different
    // clause's own text, independently of (and overlapping with) that clause's own correct
    // top-level/enumeration-item representation elsewhere in the tree (live-diagnosed via
    // both "d48-mixed-three-patterns" and "bh22-semicolon-enumeration": cross-type visible
    // ownership duplication). A genuine verb-headed enumeration item (a numbered/colon list
    // whose items are full clauses) is already correctly discovered and decomposed via the
    // ClauseFrame/PredicateFrame-driven `structureEnumerationItem` mechanism instead, never
    // through this naive conj/appos walk -- excluding predicate-like members here does not
    // reduce that coverage.
    const built = buildOneEnumerationItem(child, isFollowingMember, byHead, text)
    if (!built) continue
    items.push(built.itemNode)
    for (const nextRoot of built.nextConjunctRoots) stack.push({ token: nextRoot, isFollowingMember: true })
  }
  return byStart(items)
}

/** Prototype 2.6G2.6C4.3 -- recovers a Tree-only, non-canonical presentation supplement from
 * a comma-set-off `nmod` supplement that C3's canonical authority correctly excludes from
 * SentenceCoreSet (e.g. "Relevant data, INCLUDING a digital elevation model, ..., were
 * collected"). `nmodHead` (e.g. "model") is itself the supplement's own FIRST member -- unlike
 * `buildEnumerationChildren`'s anchor (a token that is NEVER itself a list item, only its
 * appos/conj children are), so this grounds `nmodHead` through the exact same
 * `buildOneEnumerationItem` helper first, then continues the walk over its own
 * `nextConjunctRoots` chain -- zero duplicated parsing logic, only the seeding differs. */
function buildSupplementMemberChildren(
  nmodHead: StanzaToken,
  byHead: Map<number, StanzaToken[]>,
  text: string,
  markerTokenId?: number,
): { items: StructureTreeNode[]; coveredIds: Set<number>; droppedCitationIds: Set<number> } {
  const first = buildOneEnumerationItem(nmodHead, false, byHead, text, markerTokenId)
  if (!first) return { items: [], coveredIds: new Set(), droppedCitationIds: new Set() }
  const items: StructureTreeNode[] = [first.itemNode]
  const coveredIds = new Set(first.tokenIds)
  const droppedCitationIds = new Set(first.droppedCitationIds)
  const stack: { token: StanzaToken; isFollowingMember: boolean }[] = first.nextConjunctRoots.map((token) => ({ token, isFollowingMember: true }))
  while (stack.length > 0) {
    const { token: child, isFollowingMember } = stack.pop()!
    const built = buildOneEnumerationItem(child, isFollowingMember, byHead, text)
    if (!built) continue
    items.push(built.itemNode)
    for (const id of built.tokenIds) coveredIds.add(id)
    for (const id of built.droppedCitationIds) droppedCitationIds.add(id)
    for (const nextRoot of built.nextConjunctRoots) stack.push({ token: nextRoot, isFollowingMember: true })
  }
  return { items: byStart(items), coveredIds, droppedCitationIds }
}

/** Prototype 2.6G2.6C4.3 -- identifies a canonical constituent head's own DIRECT `nmod`
 * children that C3's canonical authority (`collectConstituentTokens`'s `RESTRICTIVE_GATED`
 * set, stanzaSyntaxAuthority.ts) structurally excludes as a comma-set-off, non-restrictive
 * supplement -- re-derived here from the exact same two structural facts authority itself
 * uses (`dep === 'nmod'` and a comma in the literal gap between the constituent head and the
 * child, via the same exported `hasCommaBetween` helper authority uses), so this Tree-side
 * recovery can never disagree with what canonical authority actually excluded. Never a lexical
 * check on "including"/"such as"/etc -- the `case` marker word never decides eligibility. */
function findNonCoreNmodSupplementHeads(head: StanzaToken, byHead: Map<number, StanzaToken[]>, allTokens: StanzaToken[]): StanzaToken[] {
  return (byHead.get(head.id) ?? []).filter(
    (child) => normalizeDep(child.deprel) === 'nmod' && hasCommaBetween(allTokens, head.end, child.start),
  )
}

/** Prototype 2.6G2.6C4.3A -- true when every genuine (non-punct, non-glue) token positioned
 * inside [outerStart, outerEnd) is explained by either (a) the marker token, (b) a member's
 * own accepted token set (`coveredIds`), or (c) a subtree deliberately dropped as citation-like
 * during member discovery (`droppedCitationIds`) -- i.e. the member children, together with the
 * marker badge and the (structurally, not visibly, present) citations/connector glue, already
 * account for the ENTIRE range. `cc` tokens are exempted too: a coordinating conjunction between
 * members is never absorbed into any member's own token set (collectEnumerationItemSubtree
 * always treats it as a boundary), yet it is already represented through the accepted member's
 * own `.connector` metadata, not lost. Derived purely from token identity/position -- never a
 * string-occurrence count -- so a genuinely uncovered token (e.g. drifted content that reached
 * this range through dependency structure the member walk never followed) correctly fails this
 * check and keeps the flat fallback below. */
function supplementHasReliableMemberCoverage(
  outerStart: number,
  outerEnd: number,
  allTokens: readonly StanzaToken[],
  markerTokenId: number | undefined,
  coveredIds: ReadonlySet<number>,
  droppedCitationIds: ReadonlySet<number>,
): boolean {
  for (const token of allTokens) {
    if (token.start < outerStart || token.end > outerEnd) continue
    const dep = normalizeDep(token.deprel)
    if (dep === 'punct' || dep === 'cc') continue
    if (token.id === markerTokenId) continue
    if (coveredIds.has(token.id) || droppedCitationIds.has(token.id)) continue
    return false
  }
  return true
}

/** Prototype 2.6G2.6C4.3 -- builds one Tree-only 'supplement' node (never 'subject'/'object'/
 * 'complement'/'enumerationMember'/'coordinationMember'/'predicate' -- see 'supplement's own
 * pre-existing role semantics in structureTree.ts, reused here rather than adding a new role)
 * for a single recovered non-core nmod supplement. The container's own authority `text`/
 * `start`/`end` stay a plain contiguous source slice (the codebase-wide Span contract, per the
 * 2.6G2.5C4.1/C4.2 audit -- an interior citation between two members may still appear in that
 * raw slice, exactly like a canonical constituent's own authority span after C4.2). `.marker`
 * is the supplement's own `case` child (e.g. "including"), rendered via the SAME generic
 * marker-badge mechanism StructureTreeView.tsx already uses for any node (`showMarkerBadge`),
 * so it is visible exactly once and never duplicated as container text.
 *
 * Prototype 2.6G2.6C4.3A -- the container's DISPLAYED text (`presentationSpan.text`, what
 * `StructureTreeView`'s generic row renderer actually shows via `deriveStructureNodePresentation`)
 * previously repeated every member's own lexical content as one joined aggregate string, even
 * though each member is ALSO rendered as its own child row directly below -- cross-level visible
 * duplication (every genuine word shown twice). Fixed by checking, via
 * `supplementHasReliableMemberCoverage`, whether the member children (together with the marker
 * and citation exclusions) structurally account for the entire recovered range: when they do,
 * the container's own displayed text collapses to '' (StructureTreeView's existing
 * `showNodeText` guard then renders only the marker badge + role label, exactly the same
 * mechanism already used for a canonical slot fully decomposed into coordination-member
 * children -- see that file's own "item 6/9" doc comment) and all lexical content is shown
 * exactly once, via the children. When coverage is NOT reliable (a hypothetical future
 * decomposition gap), the previous joined-aggregate presentation text is kept as a flat,
 * information-preserving fallback -- no content is ever hidden without a child row to replace
 * it. Either way this only ever changes `presentationSpan`; the node's own grounded `text`/
 * `start`/`end` are untouched and remain a real, contiguous slice of `text`. */
function buildNonCoreNmodSupplementNode(nmodHead: StanzaToken, byHead: Map<number, StanzaToken[]>, allTokens: StanzaToken[], text: string): StructureTreeNode | null {
  const markerToken = (byHead.get(nmodHead.id) ?? []).find((c) => normalizeDep(c.deprel) === 'case')
  const marker = markerToken ? (spanFromTokens(text, [markerToken]) ?? undefined) : undefined
  const { items: members, coveredIds, droppedCitationIds } = buildSupplementMemberChildren(nmodHead, byHead, text, markerToken?.id)
  if (members.length === 0) return null
  const outerStart = Math.min(nmodHead.start, marker?.start ?? nmodHead.start, members[0]!.start)
  const outerEnd = members.at(-1)!.end
  const reliableCoverage = supplementHasReliableMemberCoverage(outerStart, outerEnd, allTokens, markerToken?.id, coveredIds, droppedCitationIds)
  const presentationText = reliableCoverage ? '' : members.map((m) => m.text).join(', ')
  return {
    text: text.slice(outerStart, outerEnd),
    role: 'supplement',
    start: outerStart,
    end: outerEnd,
    marker,
    presentationSpan: { text: presentationText, start: outerStart, end: outerEnd },
    children: byStart(members),
  }
}

// ----------------------------------------------------------------------------
// Prototype 2.6G2.2 item 4 -- surface numbered-enumeration recovery. The real KNN-GCN control
// proved that a long, syntactically complex numbered list can suffer UD coordination
// attachment drift: each new item attaches not to the list's true head but to some noun
// buried inside the PREVIOUS item's own internal clause, breaking the appos/conj chain
// `buildEnumerationChildren` walks after the first item. This detector is entirely
// independent of that dependency chain -- it looks only at explicit ordered surface markers
// "(1)", "(2)", ... in the SOURCE TEXT following a constituent that ends right at a
// list-introducing colon, and is used ONLY as a fallback when the dependency-based walk above
// found fewer than 2 members for every token in this constituent's own core. It never touches
// Stanza parsing, ClauseFrame/PredicateFrame, or SentenceCoreSet -- presentation only.
// ----------------------------------------------------------------------------

const SURFACE_ENUM_MARKER = /\(\s*(\d{1,2})\s*\)/g

/** The end of the sentence's own content, excluding a single trailing terminal punctuation
 * mark and trailing whitespace -- used as the fallback upper bound for the final list item
 * when there is no next marker to stop at. */
function sentenceContentEnd(text: string): number {
  let end = text.length
  while (end > 0 && /\s/.test(text[end - 1]!)) end -= 1
  if (end > 0 && /[.!?]/.test(text[end - 1]!)) end -= 1
  return end
}

/** Trims a raw item slice of trailing whitespace/separator punctuation and a trailing
 * "and"/"or" that belongs to the LIST's own final-item conjunction, not the item's own
 * content (e.g. "...training the model; and" -> "...training the model") -- a generic
 * English list-formatting convention, not sentence-specific lexical content. */
function trimSurfaceEnumerationItem(text: string, start: number, end: number): { start: number; end: number } {
  let s = start
  let e = end
  const shrinkTrailingSpace = () => {
    while (e > s && /\s/.test(text[e - 1]!)) e -= 1
  }
  // Order matters: the list's own final-item conjunction always trails AFTER any separator
  // punctuation in the source ("...build; and (3)..."), so "and"/"or" must be stripped first,
  // then the separator that preceded it -- stripping in the reverse order would find "d" (the
  // end of "and") where a semicolon check expects to land, and leave the semicolon behind.
  shrinkTrailingSpace()
  const wordMatch = /\b(?:and|or)\s*$/i.exec(text.slice(s, e))
  if (wordMatch) e = s + wordMatch.index
  shrinkTrailingSpace()
  if (e > s && (text[e - 1] === ';' || text[e - 1] === ',')) e -= 1
  shrinkTrailingSpace()
  return { start: s, end: e }
}

/**
 * Given a constituent's own visible end (`coreEnd`), looks for an immediate list-introducing
 * colon (within a few characters -- tolerates a trailing space, never a lexical check) and,
 * if found, scans forward for a STRICTLY sequential run of "(1)", "(2)", ... markers (2-digit
 * cap deliberately excludes 4-digit citation years -- "do not reinterpret citations as list
 * markers"). Each item's span runs from its own marker's start to the next marker's start (or
 * the sentence's content end for the last item), trimmed of trailing list punctuation/"and"/
 * "or". Returns null when fewer than 2 sequential markers are found (matches the same "genuine
 * list only" bar as the dependency-based detector).
 */
export function recoverSurfaceEnumeration(text: string, coreEnd: number): StructureTreeNode[] | null {
  const gap = text.slice(coreEnd, Math.min(coreEnd + 4, text.length))
  const colonIndex = gap.indexOf(':')
  if (colonIndex === -1) return null
  const searchFrom = coreEnd + colonIndex + 1

  const markers: { n: number; start: number; end: number }[] = []
  const re = new RegExp(SURFACE_ENUM_MARKER)
  re.lastIndex = searchFrom
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    markers.push({ n: Number(m[1]), start: m.index, end: m.index + m[0].length })
  }

  const sequence: typeof markers = []
  let expected = 1
  for (const marker of markers) {
    if (marker.n === expected) {
      sequence.push(marker)
      expected += 1
    } else if (sequence.length > 0) {
      break
    }
  }
  if (sequence.length < 2) return null

  const contentEnd = sentenceContentEnd(text)
  return sequence.map((marker, i) => {
    const rawEnd = i + 1 < sequence.length ? sequence[i + 1]!.start : contentEnd
    const { start, end } = trimSurfaceEnumerationItem(text, marker.start, rawEnd)
    return node('other', { text: text.slice(start, end), start, end }, [])
  })
}

/**
 * Generic constituent decomposition -- the single algorithm used for EVERY constituent node
 * this module builds: canonical slots (subject/object/indirectObject/complement) AND
 * predicate modifiers alike. Given a head token:
 *
 * 1. Computes the full canonical span via the frozen `collectConstituentTokens` (byte-
 *    identical to what stanzaSyntaxAuthority.ts's own converter would produce for the same
 *    head/boundaryIds/stopDeps -- never re-derives grammar; this is what keeps a canonical
 *    object/complement node's own start/end/text exactly equal to SentenceCoreSet's).
 * 2. Recursively pulls each DIRECT acl/advcl child out as its OWN decomposed child node
 *    (relativeClause for acl:relcl, postmodifier otherwise -- see postmodifierRoleFor)
 *    instead of leaving it folded into one flat span. Because this same function builds the
 *    child node, the child's OWN postmodifier/enumeration children are discovered too -- this
 *    recursion is what lets "for the mapping..." -> "based on..." -> "steps" stay a real
 *    nested chain instead of one merged leaf, and it fires identically whether the head
 *    arrived here as a canonical object or as an ordinary oblique modifier (no slot-type
 *    branch anywhere in this function).
 * 3. After postmodifier extraction, scans the REMAINING core tokens (i.e. everything still
 *    visibly part of this node's own text) for a token that owns a genuine appos/conj
 *    enumeration list (2+ members -- a lone non-restrictive appositive stays excluded,
 *    unchanged from collectConstituentTokens' own frozen bare-appos exclusion) and surfaces
 *    it as an 'enumeration' child. collectConstituentTokens already refuses to walk into a
 *    bare appos branch, so an enumeration's own members never appear anywhere else in the
 *    tree by accident -- this is the only place they are discovered, however deep the owning
 *    token sits (reachable from ANY constituent, not just a canonical object).
 * 4. Sets `presentationSpan` to the core-only range whenever anything was pulled out, so the
 *    parent's own visible text never re-includes what its children already show (B4 non-
 *    overlap discipline, unchanged from the pre-2.6G2.1 version of this function).
 */
/**
 * Prototype 2.6G2.6 -- a selected token set from `collectConstituentTokens` can be textually
 * SPARSE: some tokens strictly between its own min-start and max-end were deliberately
 * excluded (a comma-gated non-restrictive relative clause, a stopped subject/copula, ...),
 * yet `spanFromTokens` grounds a span via one CONTIGUOUS min-to-max slice of the source text
 * -- so an excluded token sitting textually between two selected tokens is silently
 * reintroduced merely because it lies inside that broad range, never because it was actually
 * selected. This is a Tree-layer-local port of the identical general fix already applied to
 * canonical authority grounding in `stanzaSyntaxAuthority.ts`'s `contiguousIslandContaining`/
 * `groundConstituentSpan` (Prototype 2.6G2.5C/C2) -- duplicated here (not imported) because
 * this phase is scoped to Tree-presentation files only and must not touch canonical grounding
 * code, even to just export an already-correct helper. Live-diagnosed need: a copular
 * complement's own root-token head also carries a sentence-opening `obl` adjunct as a direct
 * child; a Tree subject's own head can carry a token spuriously `conj`-attached past an
 * excluded non-restrictive relative clause (the same UD coordination-attachment-drift class
 * diagnosed in `d34-long-80`). Both silently widened the Tree's own presentation-authority
 * text/span past what the (already-correct) canonical SentenceCoreSet says -- "Tree must not
 * contradict frozen canonical S/V/IO/O/C" / "must not rebuild a wider complement".
 *
 * Finds the maximal run of tokens, in source order, that are either (a) part of the selected
 * set, (b) punctuation, or (c) a non-selected NOMINAL aside (e.g. an excluded bare
 * appositive), and returns only the run containing `head` -- the run only breaks at a genuine
 * excluded CLAUSE-LEVEL boundary, identified via `isPredicateLikeToken` (dependency-
 * structural, never lexical/positional).
 */
function contiguousIslandContaining(head: StanzaToken, allTokens: StanzaToken[], selected: StanzaToken[], byHead: Map<number, StanzaToken[]>): StanzaToken[] {
  const selectedIds = new Set(selected.map((t) => t.id))
  const sorted = [...allTokens].sort((a, b) => a.start - b.start)
  let current: StanzaToken[] = []
  for (const token of sorted) {
    if (selectedIds.has(token.id)) {
      current.push(token)
      continue
    }
    if (normalizeDep(token.deprel) === 'punct') continue // punctuation never breaks an island
    if (isPredicateLikeToken(token, byHead)) {
      if (current.some((t) => t.id === head.id)) return current // head's own island just closed
      current = []
    }
    // A non-selected, non-punct, non-predicate-like token (a bare excluded appositive,
    // citation subtree, ...) is a nominal aside -- bridged over, never breaks the island.
  }
  return current
}

/**
 * Prototype 2.6G2.6C2 (Structural Relative Antecedent Resolution) item 8/9 -- grounds a
 * `relativeClause` node's own ANTECEDENT span independently of Tree node ownership. `head` is
 * the relative clause's own head token (the `acl:relcl` token itself, e.g. "used"/"process"/
 * "executed"); by UD's own definition, `acl:relcl` always attaches to the nominal it
 * postmodifies, so `head.head` (already a frozen, unmodified Stanza field -- this reads it,
 * never writes it) IS the antecedent's own head token, with no guessing involved. Its full NP
 * span is grounded the SAME way any other constituent's span is grounded
 * (`collectConstituentTokens`), with two boundaries: (a) the relative clause itself
 * (`boundaryIds` seeded with `head.id`) is excluded, so a restrictive relative's own postmodifier
 * text is never folded back into its own antecedent (no circularity); (b) `COORDINATION_MEMBER_STOP_DEPS`
 * ('conj'/'cc'/'case') stops the walk at the antecedent's own direct conj/cc siblings, so
 * grounding a coordination MEMBER's antecedent (e.g. "the model selection") never re-absorbs
 * its sibling conjunct or leading connector ("but also"). Deliberately does NOT create a new
 * visible Tree node -- this is presentation METADATA only, independent of whatever node (or no
 * node at all) already represents this span elsewhere in the tree, matching section 9's
 * "authority can remain unchanged while antecedent metadata points to a grounded source span".
 */
const ANTECEDENT_STOP_DEPS: ReadonlySet<string> = new Set([...COORDINATION_MEMBER_STOP_DEPS, ...COPULAR_HEAD_STOP_DEPS])

function groundRelativeClauseAntecedent(head: StanzaToken, byHead: Map<number, StanzaToken[]>, allTokens: StanzaToken[], sourceText: string): Span | undefined {
  const antecedentToken = allTokens.find((t) => t.id === head.head)
  if (!antecedentToken) return undefined
  // Prototype 2.6G2.6C2: the antecedent token can simultaneously be (a) a coordination member
  // (needs 'conj'/'cc'/'case' excluded, COORDINATION_MEMBER_STOP_DEPS) and/or (b) the predicate-
  // nominal head of an ENCLOSING copular relative clause -- e.g. "a highly complex process"
  // in "which IS [a highly complex process] that is executed..."; "process" is simultaneously
  // this NP's own head AND the outer relative clause's own copular head, so grounding it
  // without excluding 'nsubj'/'csubj'/'cop' (COPULAR_HEAD_STOP_DEPS) would swallow the OUTER
  // clause's own "which is" back into what should be just the INNER relative's antecedent NP.
  const rawSubtree = collectConstituentTokens(antecedentToken, byHead, allTokens, new Set([head.id]), ANTECEDENT_STOP_DEPS)
  // Prototype 2.6G2.6C2 (96-corpus audit fix): `stopDeps` only bounds the antecedent token's
  // OWN direct children (collectConstituentTokens' own scoping rule) -- a predicate-like
  // token reached at any DEEPER level (e.g. through a Stanza POS-tagging mistake, live-
  // diagnosed via "bh24-long-80-plus": "flags" mistagged as a compound NOUN modifier of
  // "readings" instead of the coordinated VERB it actually is, so its own further `conj`
  // sibling "estimates ... members" -- a whole separate coordinated clause -- was reached
  // through it) is never legitimately part of an antecedent NP. Excluding every predicate-
  // like token found anywhere in the grounded subtree, together with everything reachable
  // only through it, closes this the same general way Problem E's fix did elsewhere in this
  // file: dependency/POS-structural, never text/case-specific.
  const excluded = new Set<number>()
  for (const t of rawSubtree) {
    if (t.id === antecedentToken.id) continue
    if (isPredicateLikeToken(t, byHead)) excluded.add(t.id)
  }
  let subtree = rawSubtree
  if (excluded.size > 0) {
    const keepIds = new Set<number>()
    const stack = [antecedentToken]
    while (stack.length > 0) {
      const current = stack.pop()!
      if (keepIds.has(current.id) || excluded.has(current.id)) continue
      keepIds.add(current.id)
      for (const child of byHead.get(current.id) ?? []) {
        if (rawSubtree.some((t) => t.id === child.id)) stack.push(child)
      }
    }
    subtree = rawSubtree.filter((t) => keepIds.has(t.id))
  }
  // Prototype 2.6G2.6C2 (96-corpus audit fix, continued): even after the predicate-like
  // exclusion above, a POS-tagging mistake can mislabel an entire coordinated predicate as a
  // NOUN too (live-diagnosed on the same "bh24" sentence: Stanza tagged "estimates" itself as
  // NOUN, so `isPredicateLikeToken` cannot catch it either) -- the relative clause's own
  // excluded span (`boundaryIds`) then leaves a GAP in the source text between the antecedent
  // token and that drifted, non-contiguous chunk. `contiguousIslandContaining` (Prototype
  // 2.6G2.6, already used elsewhere in this file to stop canonical-slot authority-drift the
  // same way) restricts the grounded span to the single contiguous run of text actually
  // containing the antecedent token, generally discarding any such gap-separated drift
  // regardless of why it was reached.
  const islandSubtree = contiguousIslandContaining(antecedentToken, allTokens, subtree, byHead)
  const span = spanFromTokens(sourceText, islandSubtree.length > 0 ? islandSubtree : subtree)
  if (!span || span.text.trim().length === 0) return undefined
  return span
}

function buildDecomposedConstituentNode(
  role: StructureDisplayRole,
  head: StanzaToken,
  byHead: Map<number, StanzaToken[]>,
  allTokens: StanzaToken[],
  boundaryIds: ReadonlySet<number>,
  sourceText: string,
  stopDeps: ReadonlySet<string> = new Set(),
): StructureTreeNode {
  // Citation-safe (Prototype 2.6G2.2 item 1): reuses the same dependency-subtree-based
  // citation exclusion `groundConstituentSpan` uses in stanzaSyntaxAuthority.ts, applied here
  // too. Without this, a citation attached far from the constituent's own core (e.g. after a
  // sibling coordinated predicate that boundaryIds already excludes) would still leak into
  // this node's span -- spanFromTokens grounds a CONTIGUOUS text slice from the selected
  // tokens' min-start to max-end, so even correctly-excluded tokens in between remain visible
  // as literal text unless the trailing citation tokens are removed from the set first.
  const rawFullSubtree = stripCitationTokens(sourceText, head, collectConstituentTokens(head, byHead, allTokens, boundaryIds, stopDeps), byHead)
  // Prototype 2.6G2.6: restrict to the contiguous island containing `head` for every
  // canonical-slot role (subject/object/indirectObject/complement) -- ordinary modifiers,
  // postmodifiers, relative clauses, and coordination members are unaffected (they were never
  // the source of authority-drift; only a canonical slot's own top-level span must never
  // exceed what canonical SentenceCoreSet grounding would produce).
  let fullSubtree = CANONICAL_SLOT_ROLES.has(role) ? contiguousIslandContaining(head, allTokens, rawFullSubtree, byHead) : rawFullSubtree

  // Prototype 2.6G2.6C (Generalized Tree Presentation Completion) Problem E: a conj chain
  // rooted at `head` that includes a predicate-like member (see the coordination-member
  // block just below for the full diagnosis: this is UD coordination-attachment-drift, a
  // NEIGHBORING clause's own verb mis-attached via `conj`, never a genuine same-slot NP/AP
  // coordination) is rejected from becoming visible coordination-member children -- but
  // `collectConstituentTokens`/`contiguousIslandContaining` above still happily walked into
  // that member's ENTIRE subtree while grounding this container's own flat span, since a
  // frozen-authority conj walk has no reason to know it doesn't belong here. Left uncorrected,
  // the container's own flat text balloons to include a completely different, separately-
  // owned clause's own text (cross-type visible ownership duplication -- live-diagnosed via
  // both "d48-mixed-three-patterns", where a coordinated-predicate's complement absorbed the
  // OTHER coordinated predicates' own text, and "bh22-semicolon-enumeration", where a
  // semicolon-list item's own adjectival complement absorbed the NEXT list item's entire
  // clause). Trimming here applies regardless of whether the block below actually builds
  // visible members (it can't, the same predicate-like member is what disqualifies it) --
  // the drifted member's subtree is simply excluded from this container's own text/span
  // entirely, exactly the same positional exclusion the coordination-member block already
  // performs for its own accepted case, just applied here too.
  if (CANONICAL_SLOT_ROLES.has(role) && !stopDeps.has('conj') && startsCoordinationChain(head, byHead)) {
    const rawChain = collectConjChain(head, byHead)
    const hasPredicateLikeMember = rawChain.some((member) => member.id !== head.id && isPredicateLikeToken(member, byHead))
    if (hasPredicateLikeMember) {
      const drift = new Set<number>()
      for (const member of rawChain) {
        if (member.id === head.id) continue
        for (const t of collectConstituentTokens(member, byHead, allTokens, new Set(), new Set())) drift.add(t.id)
      }
      fullSubtree = fullSubtree.filter((t) => !drift.has(t.id))
    }
  }

  const fullIds = new Set(fullSubtree.map((t) => t.id))
  const fullSpan = spanFromTokens(sourceText, fullSubtree.length > 0 ? fullSubtree : rawFullSubtree)!

  const childNodes: StructureTreeNode[] = []
  const excludedIds = new Set<number>()

  // Prototype 2.6G2.5B3 item 6: a coordination chain rooted directly at THIS constituent's
  // own head (not a nested dependent -- see the "never fires for a conj/cc chain rooted AT
  // this node's own head" restriction on the loop below) is decomposed into sibling
  // coordination-member children for a canonical slot role. Each member is independently
  // decomposed (so e.g. the second conjunct's own relative-clause postmodifier is still
  // discovered, via the SAME recursive call this function already makes for every other
  // constituent). fullSpan/fullSubtree above are computed BEFORE this point and are never
  // touched here -- the node's own authority text/span stays exactly what
  // collectConstituentTokens/SentenceCoreSet would produce.
  // `!stopDeps.has('conj')` guards against infinite recursion: a coordination MEMBER is
  // itself built via this same function with COORDINATION_MEMBER_STOP_DEPS (which includes
  // 'conj'), and `startsCoordinationChain` looks only at raw dependency structure -- it
  // would otherwise re-detect the exact same chain on member 0 (which is `head` itself) and
  // recurse forever. The chain is also rejected (bailing to the ordinary single-span
  // behavior) if ANY non-head member is itself predicate-like (`isPredicateLikeToken`,
  // already the frozen authority's own verb/finite-clause-head signal) -- e.g. "complex"
  // conj "influenced" in "...is very complex and is influenced by..." is predicate
  // coordination (a further finite clause-level verb), not a same-slot NP/AP coordination,
  // and is already fully handled elsewhere (same-clause: ClauseFrame.predicateHeadIds/
  // connectorSpan at the clause-assembly level; cross-clause: a mis-attached conj reaching
  // into a NEIGHBORING clause's own verb, e.g. a semicolon-list item's complement
  // incidentally conj-linked to the next item's own verb) -- decomposing either here would
  // double the visible connector (item 9's "visible duplication 0" gate). Dependency-
  // structure-based, never text/POS-blind: a genuinely coordinated complement made of two
  // adjectives (e.g. "accurate and reliable", neither ever predicate-like) still decomposes
  // normally.
  if (
    CANONICAL_SLOT_ROLES.has(role) &&
    !stopDeps.has('conj') &&
    startsCoordinationChain(head, byHead) &&
    !(byHead.get(head.id) ?? []).some((c) => normalizeDep(c.deprel) === 'conj' && isPredicateLikeToken(c, byHead))
  ) {
    // Prototype 2.6G2.6: `collectConjChain` walks the RAW dependency graph, unaffected by the
    // island restriction above -- a token spuriously `conj`-attached to `head` past an
    // excluded non-restrictive clause (the d34-diagnosed UD coordination-attachment-drift
    // class) is still structurally a `conj` child of `head` and would otherwise be treated as
    // a genuine coordination member here, producing a wrong-ownership decomposition (an
    // enumeration item belonging to a DIFFERENT, excluded clause presented as if it were a
    // coordinate member of this constituent) even after the authority text/span itself was
    // correctly narrowed. Filtering the chain to members whose token actually survived into
    // the island-restricted `fullIds` closes this: a drifted member was never in the same
    // island as `head` to begin with, so it is silently dropped from the chain instead of
    // becoming a wrong sibling.
    const chain = collectConjChain(head, byHead).filter((t) => fullIds.has(t.id))
    if (chain.length > 1) {
      // Prototype 2.6G2.6C item B/6/7: members never inherit the canonical slot's own role
      // (see 'coordinationMember' doc comment in structureTree.ts) -- the canonical role
      // ("subject"/"object"/...) belongs solely to the container node returned at the bottom
      // of this function, which is untouched by this block and keeps `role` unchanged.
      const members = buildCoordinationMemberNodes(chain, byHead, allTokens, boundaryIds, sourceText, 'coordinationMember')
      // Exclude every outer token whose position falls WITHIN a member's own rendered span
      // (positional, not identity-based) -- a member's own text is grounded via a
      // CONTIGUOUS slice (spanFromTokens), so a token that a stopDep caused
      // collectConstituentTokens to omit from its formal selection (e.g. a `case` marker
      // nested two hops inside a possessive NP, "'s" in "Pearson's correlation...") can
      // still fall textually inside the member's own start/end range without ever being
      // added to an identity-based excluded set -- left unexcluded, that lone leftover
      // token would otherwise surface as a nonsensical, isolated coreSpan fragment (this
      // exact case was diagnosed live: a coordinated-subject presentationSpan collapsing to
      // just "'s"). Positional exclusion closes this class of gap generally, not by
      // special-casing the possessive marker.
      for (const t of fullSubtree) {
        if (members.some((m) => t.start >= m.start && t.end <= m.end)) excludedIds.add(t.id)
      }
      // The `cc` token(s) between members sit in the GAP outside every member's own span
      // (never inside one), so the positional exclusion above never reaches them --
      // excluded explicitly here instead, the same way predicate/NP coordination already
      // does elsewhere in this file.
      for (const chainToken of chain) {
        for (const cc of byHead.get(chainToken.id) ?? []) {
          if (normalizeDep(cc.deprel) === 'cc') excludedIds.add(cc.id)
        }
      }
      // Prototype 2.6G2.6B item 5/6/7 (narrowed by 2.6G2.6C2 -- see below): presentation-scope
      // promotion of a nonrestrictive relative clause from one coordination member up to the
      // coordination container itself, so it reads as modifying the whole coordinated phrase
      // rather than sitting oddly beside unrelated sibling members. Purely a PRESENTATION
      // decision made AFTER the fact -- never touches raw Stanza authority (the relative
      // clause's own source span/parent is untouched; `buildCoordinationMemberNodes` already
      // built it exactly where raw dependency attachment says it belongs).
      //
      // Prototype 2.6G2.6C2 item 3/4/5/6 -- LIVE FAILURE FIX: the previous version promoted
      // ANY comma-delimited, post-coordination relative clause regardless of WHICH member it
      // was raw-attached to, which was proven too broad by a live "not only A but also B,
      // which ..." control -- Stanza attaches "which" there to B (the LAST conjunct, `members`
      // index > 0), not to the coordination's own syntactic head, yet the old code still
      // promoted it to "the whole coordination", producing a false antecedent (both A and B
      // underlined) when only B is the true antecedent. Diagnosis (see the live diff report):
      // in UD's head-medial conj representation, `members[0]` IS the coordination's own head
      // token (`collectConjChain` always starts from `head`, i.e. this exact function's own
      // `head` parameter) -- a relative clause raw-attached there is Stanza's own standard way
      // of marking "this modifies the coordinated NP as a whole" (matches the accepted VIF/PCC
      // control, where "which" attaches to the FIRST/head conjunct). A relative clause found
      // nested under any OTHER member (`members[1]`, `members[2]`, ...) was raw-attached
      // SPECIFICALLY to that member, not to the coordination's head -- positive structural
      // evidence it scopes to that one member alone (section 4: "prefer that member as the
      // antecedent... generic but conservative > broad but wrong"), so it is left exactly
      // where `buildCoordinationMemberNodes` already nested it. Promotion is therefore now
      // restricted to `members[0]` only, still gated on nonrestrictive comma-delimiting
      // (`hasCommaBetween`) and on the relative clause occurring after the full coordination
      // in source order (never a relative attached to `head` but positioned mid-coordination,
      // e.g. modifying only the head conjunct before a later member starts).
      const coordinationEnd = Math.max(...members.map((m) => m.end))
      const headMember = members[0]!
      const promotedRelcl = headMember.children.find((c) => c.role === 'relativeClause' && c.start >= coordinationEnd)
      if (promotedRelcl && hasCommaBetween(allTokens, headMember.end, promotedRelcl.start)) {
        // Prototype 2.6G2.6C3 Part A item 3/5/6 -- before committing to whole-coordination
        // promotion, check the relative clause's OWN predicate for NEGATIVE agreement
        // evidence: a clearly SINGULAR copula/aux ("is"/"was"/"has") on a 2+-member
        // coordination is strong evidence against a genuine collective/whole-coordination
        // reading (live-diagnosed: "The temperature and the humidity sensor, which IS
        // installed outdoors, ..." -- "is" cannot agree with the plural coordination as a
        // whole). This is used as EVIDENCE, never an infallible rule (a PLURAL or 'unknown'
        // form is treated as neutral/compatible, not proof either way) -- see
        // `relativeClauseAgreement`'s own doc comment.
        const relclHeadToken = (byHead.get(head.id) ?? []).find((c) => c.deprel === 'acl:relcl')
        const agreement = relclHeadToken ? relativeClauseAgreement(relclHeadToken, byHead) : 'unknown'
        if (agreement === 'singular') {
          // Prototype 2.6G2.6C3 Part A item 6: whole-coordination promotion is rejected by
          // the negative evidence above, but raw UD still only tells us this relative clause
          // is nested under `headMember` (member 0) -- that attachment target is EXACTLY the
          // same ambiguous signal shared by the genuinely coordination-wide case (Control A),
          // so it carries no independent proof that member 0 itself is the true antecedent
          // either (section 6: "do NOT automatically underline that raw member... if no
          // reliable structural evidence identifies the actual member: antecedentSpan =
          // undefined"). The relative clause stays exactly where it already sits (nested
          // under `headMember`, never promoted) -- interaction/hover/click and its own
          // authority/presentation spans are completely unaffected; only its antecedent
          // metadata is cleared, matching "no underline > wrong underline".
          promotedRelcl.antecedentSpan = undefined
        } else {
          headMember.children = headMember.children.filter((c) => c !== promotedRelcl)
          // Prototype 2.6G2.6C2 item 5/9: `promotedRelcl.antecedentSpan` (as grounded by
          // `groundRelativeClauseAntecedent`) still only covers `headMember`'s own span --
          // ANTECEDENT_STOP_DEPS deliberately stops at the antecedent token's own conj/cc
          // children, so it never reached across into the OTHER members on its own. Now that
          // this relative clause is confirmed (by the promotion condition above, with no
          // negative agreement evidence found) to genuinely scope over the WHOLE
          // coordination, its antecedent metadata is widened to match -- the first member's
          // own start through the last member's own end, i.e. exactly the coordination's own
          // combined span, never the individual head member's span alone.
          const firstMember = members[0]!
          promotedRelcl.antecedentSpan = {
            text: sourceText.slice(firstMember.start, coordinationEnd),
            start: firstMember.start,
            end: coordinationEnd,
          }
          childNodes.push(promotedRelcl)
        }
      }
      // Prototype 2.6G2.6C4 Part C -- CANONICAL_CONSTITUENT_SUPPLEMENT_LOSS. A bare
      // non-restrictive appositive supplement attached DIRECTLY to the coordination's own
      // head (`head`/`chain[0]`) -- distinct from the conj chain itself, e.g. "Several
      // factors, namely rainfall intensity..., slope angle, and soil type, contribute..."
      // where Stanza treats "factors"/"angle"/"type" as one raw conj chain while "intensity"
      // (the actual supplement head) is a SEPARATE `appos` child of "factors" -- was
      // otherwise silently dropped entirely: it is correctly excluded from canonical
      // authority (a bare appositive is a non-restrictive aside by SentenceCoreSet's own
      // rule), and the general dependency-enumeration discovery pass just above never runs
      // for a coordination member (`!stopDeps.has('conj')`, deliberately, to avoid
      // re-detecting the SAME conj chain the caller already split into `members` as a bogus
      // second "enumeration"). A bare appositive is a structurally DIFFERENT relation from
      // that conj chain (`collectConjChain` never reaches it), so surfacing it here can never
      // re-discover the same members -- built as a neutral 'modifier' supplement child of the
      // coordination CONTAINER (sibling of `members`, single visible owner), reusing its own
      // internal coordination/enumeration decomposition recursively via the ordinary
      // (non-coordination-member) `buildDecomposedConstituentNode` call. Skipped when the
      // appositive is already included in this container's own canonical span via the SAME
      // PP-object/paren-wrapped-abbreviation exception `collectConstituentTokens` itself
      // uses (re-adding it here would duplicate it).
      const chainIds = new Set(chain.map((t) => t.id))
      for (const supplementCandidate of byHead.get(head.id) ?? []) {
        if (normalizeDep(supplementCandidate.deprel) !== 'appos') continue
        if (chainIds.has(supplementCandidate.id)) continue
        if (isPredicateLikeToken(supplementCandidate, byHead)) continue
        const apposChildren = byHead.get(supplementCandidate.id) ?? []
        const isPpObject = apposChildren.some((gc) => normalizeDep(gc.deprel) === 'case')
        const isParenWrappedAbbreviation = apposChildren.some((gc) => gc.text === '(') && apposChildren.some((gc) => gc.text === ')')
        if (isPpObject || isParenWrappedAbbreviation) continue
        childNodes.push(buildDecomposedConstituentNode('modifier', supplementCandidate, byHead, allTokens, new Set(), sourceText))
      }
      childNodes.push(...members)
    }
  }

  // Prototype 2.6G2.6B: when `head` itself was just consumed as coordination MEMBER 0 by
  // the head-rooted coordination block above (`excludedIds.has(head.id)`), its own direct
  // children were ALREADY fully examined by that member's own recursive
  // buildDecomposedConstituentNode call (including any restrictive relative clause, which
  // -- unlike a non-restrictive one -- stays INSIDE the member's own selected token set and
  // so is not separately caught by the buried-scan loop below either). Re-walking `head`'s
  // own children here would rebuild that same restrictive relativeClause a SECOND time, as
  // an unrelated sibling of the coordination members instead of staying nested inside
  // member 0 where it was already correctly placed -- a genuine duplicate-ownership bug,
  // live-diagnosed via a restrictive relative on one coordination member.
  for (const child of excludedIds.has(head.id) ? [] : (byHead.get(head.id) ?? [])) {
    if (!fullIds.has(child.id)) continue // already excluded by the canonical rules (e.g. non-restrictive)
    const dep = normalizeDep(child.deprel)
    if (POSTMODIFIER_CLAUSE_DEPS.has(dep)) {
      const childSubtree = collectConstituentTokens(child, byHead, allTokens, boundaryIds)
      for (const t of childSubtree) excludedIds.add(t.id)
      childNodes.push(buildDecomposedConstituentNode(postmodifierRoleFor(child.deprel), child, byHead, allTokens, boundaryIds, sourceText))
      continue
    }
    // NP/PP-internal coordination (Prototype 2.6G2.3 item 3): a non-conj/cc direct child
    // that itself HEADS a conj chain (e.g. "conditions" in "a mixture of geological
    // conditions and environmental factors") is split into sibling coordination-member
    // nodes instead of staying flattened into this constituent's own text -- never fires
    // for a conj/cc chain rooted AT this node's own head (that stays the frozen canonical
    // single span, matching SentenceCoreSet exactly), only for one nested below it.
    //
    // Prototype 2.6G2.6C5 (refines the 2.6G2.6C item 2/3 "major vs internal coordination"
    // heuristic) -- the previous test ("does any chain member have a child besides its own
    // conj/cc bookkeeping") counted a member's own leading comma as such a child, since PUNCT
    // was never excluded from that check -- a live control ("Ordovician, Silurian, Devonian,
    // Carboniferous, Quaternary, and igneous rocks of various stages") showed every
    // comma-preceded member incidentally satisfying the OLD test for the wrong reason (a list
    // separator, not real internal NP structure). Excluding punct from that same check alone
    // would have UNDER-fired instead: a bare comma-free list like "Ordovician, ..." still
    // needs a second, independent signal, since a comma-separated list's own members can
    // legitimately be bare single words with no other child at all. Two independent,
    // structural (never lexical) signals now decide MAJOR status, matching the two real
    // patterns this codebase's own accepted fixtures require:
    //  (a) any chain member carries a real non-punct/non-conj/non-cc child of its own (e.g.
    //      "alpha" modifying "factors" in "alpha factors and beta conditions") -- each
    //      conjunct dominates SUBSTANTIAL NP structure of its own, matching the ORIGINAL
    //      2.6G2.6C test's own intent, just now punct-safe; or
    //  (b) any adjacent pair in the chain is comma-delimited in source order (the same
    //      exported `hasCommaBetween` authority helper C3/C4.3 already trust for "is this a
    //      genuine list") -- a comma-separated list is a genuine list regardless of whether
    //      its own bare members carry further internal structure.
    // A chain satisfying NEITHER (e.g. "training and testing", "precision and recall" -- bare,
    // comma-free, no member has any child beyond its own conj/cc) stays flat, unchanged.
    if (dep !== 'conj' && dep !== 'cc' && startsCoordinationChain(child, byHead)) {
      const chain = collectConjChain(child, byHead)
      const hasSubstantiveMemberContent = chain.some((member) =>
        (byHead.get(member.id) ?? []).some((c) => {
          const memberChildDep = normalizeDep(c.deprel)
          return memberChildDep !== 'conj' && memberChildDep !== 'cc' && memberChildDep !== 'punct'
        }),
      )
      const isCommaSeparatedList = chain.slice(1).some((member, i) => hasCommaBetween(allTokens, chain[i]!.end, member.start))
      const isMajorCoordination = hasSubstantiveMemberContent || isCommaSeparatedList
      if (isMajorCoordination) {
        const members = buildCoordinationMemberNodes(chain, byHead, allTokens, boundaryIds, sourceText, 'coordinationMember')
        // Prototype 2.6G2.6C5 -- shared-head trailing member: `head` itself, together with
        // whatever else of its own core remains (e.g. "igneous rocks of various stages"), is
        // grammatically the LAST coordinate item of this SAME list when `head` carries its
        // own direct `cc` child positioned after the premodifier chain -- the elliptical "A,
        // B, ..., and C head" pattern, where every earlier member elides the shared head noun
        // Stanza only writes once, on the final conjunct. Never fires when `head` has no such
        // trailing `cc` (the ordinary "conditions and factors"-style nested coordination,
        // where `head` itself is never part of the coordinate series).
        const headCc = (byHead.get(head.id) ?? []).find((c) => normalizeDep(c.deprel) === 'cc' && c.start > chain.at(-1)!.end)
        let allMembers = members
        if (headCc) {
          const chainIds = new Set(chain.map((t) => t.id))
          const { tokens: headSubtree } = collectEnumerationItemSubtree(head, byHead, sourceText)
          // `collectEnumerationItemSubtree` walks `head`'s full dependency subtree with no
          // knowledge of THIS constituent's own `stopDeps` (e.g. COPULAR_HEAD_STOP_DEPS) --
          // when `head` is also a clause's own root/predicate-nominal token (a copular
          // complement's head, e.g. "rocks" in "The samples ARE Ordovician, ..., and igneous
          // ROCKS"), `head` also carries the clause's own nsubj/cop children in the RAW
          // dependency graph, which that walk would otherwise absorb wholesale into this
          // "final member" -- reconstructing the entire sentence as one bogus member. `fullIds`
          // (already computed above via the stopDeps-aware `collectConstituentTokens`) is the
          // authoritative boundary of what legitimately belongs to THIS constituent; the final
          // member's own token set is intersected with it so it can never reach outside that
          // boundary, matching the exact same discipline every other child-building block in
          // this function already follows.
          const finalSubtree = headSubtree.filter((t) => !chainIds.has(t.id) && fullIds.has(t.id))
          const finalSpan = spanFromTokens(sourceText, finalSubtree)
          if (finalSpan && !isCitationLike(finalSpan)) {
            const connector = spanFromTokens(sourceText, [headCc]) ?? undefined
            allMembers = [...members, node('coordinationMember', finalSpan, [], connector)]
          }
        }
        // Range-based exclusion (not per-member positional-only): the whole coordination's
        // own consumed range -- from the first member's start to the last member's end --
        // includes inter-member glue (commas, the connector `cc`) that belongs to no single
        // member's own span but must still never resurface in this container's own remaining
        // `coreSpan` (spanFromTokens grounds a CONTIGUOUS slice, so leaving even one stray
        // token unexcluded inside this range would silently reconstruct the entire original
        // text there again -- the exact cross-level visible-duplication class 2.6G2.6C4.3A
        // already fixed for supplements, applied here to the same risk).
        const coordinationStart = Math.min(...allMembers.map((m) => m.start))
        const coordinationEnd = Math.max(...allMembers.map((m) => m.end))
        for (const t of fullSubtree) {
          if (t.start >= coordinationStart && t.end <= coordinationEnd) excludedIds.add(t.id)
        }
        childNodes.push(...allMembers)
      }
      // else: internal premodifier coordination -- left flat, absorbed into this
      // constituent's own presentation text exactly as before 2.6G2.3 (no children pushed,
      // no tokens excluded); the connector word ("and") simply remains literal text inside
      // the parent's own presentationSpan, matching the low-value-internal-coordination
      // hard gate (no redundant child decomposition, no duplicated member text).
    }
  }

  // Non-restrictive (comma-gated) acl/acl:relcl/advcl postmodifiers (Prototype 2.6G2.5B --
  // "which are commonly used in the field" style relative clauses): the frozen
  // collectConstituentTokens above already excludes these from fullSubtree/fullIds entirely
  // (RESTRICTIVE_GATED's own comma check, matching canonical SentenceCoreSet, which also
  // never includes non-restrictive material) -- but that exclusion left them with NO
  // representation anywhere in the Tree at all, since the loop above only ever looks at
  // children already present in fullIds. Captured here as ADDITIONAL postmodifier children
  // (never instead of the restrictive ones the loop above already found) -- their tokens
  // were never part of fullSubtree/coreTokens to begin with, so there is nothing to exclude
  // and no risk of overlapping this node's own core span (B4 non-overlap holds by
  // construction, not by an extra check).
  // Prototype 2.6G2.5B2 item 5 (the "interaction case"): the direct-children-only version of
  // this scan missed a relative clause BURIED under a non-restrictive appositive that is
  // itself nested inside an nmod chain (e.g. "...measurements of the deck, sensor readings,
  // which exceed..." -- "readings" is a bare appos of "deck", itself an nmod of
  // "measurements"; "deck" is never independently decomposed since nmod stays flat within
  // the parent's own core text, so "readings"'s own acl:relcl child was never reachable from
  // any head this function was ever called with). Generalized to scan every token still
  // present in this constituent's own flat core (`fullSubtree`, not just `head` itself) for
  // (a) a non-restrictive acl/advcl direct child (the existing check, now reachable at any
  // depth, not only directly under `head`), and (b) a bare non-restrictive appositive child
  // (excluded from the core the same way collectConstituentTokens itself excludes it) that
  // itself carries an acl:relcl -- the relative clause is surfaced without resurrecting the
  // appositive noun's own flat text (which stays correctly excluded, matching canonical
  // SentenceCoreSet). Strictly additive: every case the original head-only scan already
  // found is still found (head is trivially a member of fullSubtree).
  for (const coreToken of fullSubtree) {
    // A token already claimed by loop 1 above (a restrictive postmodifier or coordination
    // member, each independently/recursively decomposed by its own buildDecomposedConstituentNode
    // call) must never be re-scanned here -- its own children were already examined by that
    // recursive call's own two loops, so re-scanning them here would risk double-extracting
    // the same deeper node via two different paths.
    if (excludedIds.has(coreToken.id)) continue
    for (const child of byHead.get(coreToken.id) ?? []) {
      if (fullIds.has(child.id)) continue // already handled above, or genuinely part of the core
      const dep = normalizeDep(child.deprel)
      if (POSTMODIFIER_CLAUSE_DEPS.has(dep)) {
        childNodes.push(buildDecomposedConstituentNode(postmodifierRoleFor(child.deprel), child, byHead, allTokens, boundaryIds, sourceText))
        continue
      }
      if (dep === 'appos') {
        const relcl = (byHead.get(child.id) ?? []).find((gc) => gc.deprel === 'acl:relcl')
        if (relcl) childNodes.push(buildDecomposedConstituentNode('relativeClause', relcl, byHead, allTokens, boundaryIds, sourceText))
      }
    }
  }

  // Prototype 2.6G2.5B3 item 6/9: when every one of this constituent's own tokens was
  // reassigned to a decomposed child (the head-rooted coordination case above can consume
  // the ENTIRE constituent, leaving no independent "trunk" prefix the way "a mixture of X
  // and Y" leaves "a mixture of"), falling back to the full authority text here would just
  // duplicate everything the children already show -- an empty presentation text instead
  // (rendered as no separate lexical row by StructureTreeView, matching the "structural
  // container != duplicate lexical row" principle already used for enumeration/clause).
  const coreTokens = fullSubtree.filter((t) => !excludedIds.has(t.id))
  const coreSpan = coreTokens.length > 0 ? (spanFromTokens(sourceText, coreTokens) ?? fullSpan) : { text: '', start: fullSpan.start, end: fullSpan.start }

  // Prototype 2.6G2.5B3 item 6/9 (fix): when THIS call is itself building one coordination
  // MEMBER (stopDeps carries 'conj', see COORDINATION_MEMBER_STOP_DEPS), the member's own
  // head can still show a raw `conj` chain in byHead (stopDeps only bounded fullSubtree
  // selection, it doesn't erase the dependency graph) -- that chain is precisely the
  // sibling coordination the CALLER already split out as top-level coordination-member
  // children, so re-discovering it here as an 'enumeration' child would visibly duplicate
  // it (each sibling shown once as a coordination member AND again nested inside member 0's
  // own "enumeration"). Never this member's own list to claim.
  let dependencyEnumerationFound = false
  if (!stopDeps.has('conj')) {
    for (const t of coreTokens) {
      const items = buildEnumerationChildren(t.id, byHead, sourceText).filter((i) => i.start >= coreSpan.end)
      if (items.length < 2) continue // a genuine list only -- a lone appositive stays excluded (matches collectConstituentTokens)
      dependencyEnumerationFound = true
      const enumSpan: Span = { text: sourceText.slice(items[0]!.start, items.at(-1)!.end), start: items[0]!.start, end: items.at(-1)!.end }
      childNodes.push(node('enumeration', enumSpan, items))
    }
  }
  // Surface numbered-marker fallback (item 4): only tried when the clean dependency-based
  // walk above found nothing usable for this constituent -- dependency-based enumeration
  // remains preferred whenever it's clean, this never overrides a successful result.
  if (!dependencyEnumerationFound) {
    const surfaceItems = recoverSurfaceEnumeration(sourceText, coreSpan.end)
    if (surfaceItems) {
      const enumSpan: Span = { text: sourceText.slice(surfaceItems[0]!.start, surfaceItems.at(-1)!.end), start: surfaceItems[0]!.start, end: surfaceItems.at(-1)!.end }
      childNodes.push(node('enumeration', enumSpan, surfaceItems))
    }
  }

  // Prototype 2.6G2.6C4.3 -- a canonical slot's own comma-set-off `nmod` supplement (excluded
  // from `fullSubtree`/`fullSpan` above by the exact same authority helper that grounds
  // SentenceCoreSet, so it is otherwise completely invisible to this function) is recovered
  // as Tree-only presentation content, additive to (never replacing) the canonical container's
  // own authority text/span. Scoped to `CANONICAL_SLOT_ROLES` -- the only roles whose
  // `collectConstituentTokens` call above can ever have excluded an nmod this way in the first
  // place (an ordinary modifier/postmodifier build never hits that exclusion, so there is
  // nothing to recover for it).
  if (CANONICAL_SLOT_ROLES.has(role)) {
    for (const supplementHead of findNonCoreNmodSupplementHeads(head, byHead, allTokens)) {
      const supplementNode = buildNonCoreNmodSupplementNode(supplementHead, byHead, allTokens, sourceText)
      if (supplementNode) childNodes.push(supplementNode)
    }
  }

  const antecedentSpan = role === 'relativeClause' ? groundRelativeClauseAntecedent(head, byHead, allTokens, sourceText) : undefined

  if (childNodes.length === 0) {
    return { text: fullSpan.text, role, start: fullSpan.start, end: fullSpan.end, children: [], antecedentSpan }
  }

  return {
    text: fullSpan.text,
    role,
    start: fullSpan.start,
    end: fullSpan.end,
    presentationSpan: coreSpan,
    antecedentSpan,
    children: byStart(childNodes),
  }
}

/** Everything found among a head's children that is NOT one of the canonical slot heads
 * already claimed (obj/iobj/xcomp/ccomp/cop/aux) and not a restrictive postmodifier already
 * folded into a constituent node above -- oblique arguments, adverbial modifiers, and any
 * other adjunct. Never promoted to object/complement; always the generic 'modifier' role
 * (product principle -- generic but correct beats specific but wrong). Each candidate is now
 * built through the SAME recursive decomposition as a canonical slot (item 3 of Prototype
 * 2.6G2.1), so a modifier's own nested postmodifier/enumeration structure is preserved
 * instead of being flattened into one leaf span. */
// advcl/acl/csubj/parataxis are excluded here because they are clause-starting deprels
// (see stanzaSyntaxAuthority.ts's CLAUSE_STARTING_DEPRELS) -- each already gets its own
// ClauseFrame and is handled at the clause-assembly level (sentence-level subordinate
// clauses become top-level siblings; NP-attached acl/advcl becomes a postmodifier/
// relativeClause child via buildDecomposedConstituentNode). Treating one here too would
// visibly duplicate it as a modifier.
// `expl` (Prototype 2.6G2.5B / 2.6G2.5B2 item B9): an existential/expletive pronoun ("there
// is...", "it seems...") is excluded HERE (the ordinary oblique/adverbial modifier path) by
// its structural dependency role, never `text === 'there'` -- an expletive is not a genuine
// adverbial and must never reach the opening-modifier position check (that was the live-
// diagnosed "there" -> 前置き misclassification's actual root cause). It is NOT suppressed
// from the tree entirely, though: buildPredicateNode builds it as its own dedicated
// 'expletive' node before calling this function, so excluding it here only prevents a
// duplicate/miscategorized second representation, never the only one.
// `discourse` (Prototype 2.6G2.6C item 6): a bare numeral like "1"/"2" inside a surface list
// marker "(1)"/"(2)" attaches to its item's own first predicate head via this deprel -- it is
// the enumeration item's own MARKER, not a grammatical modifier of the predicate, and must
// never surface as one (matches "do not make the marker itself a grammar S/V/O/C node").
const CANONICAL_SLOT_DEPS = new Set([
  'nsubj', 'csubj', 'obj', 'iobj', 'xcomp', 'ccomp', 'cop', 'aux', 'mark', 'cc', 'conj', 'punct',
  'advcl', 'acl', 'parataxis', 'expl', 'discourse',
])

function buildModifierNodes(
  predicateHead: StanzaToken,
  byHead: Map<number, StanzaToken[]>,
  allTokens: StanzaToken[],
  text: string,
  claimedTokenIds: ReadonlySet<number>,
  consumedSpans: readonly Span[],
): StructureTreeNode[] {
  const nodes: StructureTreeNode[] = []
  for (const child of byHead.get(predicateHead.id) ?? []) {
    const dep = normalizeDep(child.deprel)
    if (dep === 'aux:pass' || CANONICAL_SLOT_DEPS.has(dep)) continue
    if (claimedTokenIds.has(child.id)) continue
    if (dep === 'appos' || dep === 'parataxis') continue // handled by enumeration/citation logic
    const candidate = buildDecomposedConstituentNode('modifier', child, byHead, allTokens, new Set(), text)
    if (isCitationLike({ text: candidate.text, start: candidate.start, end: candidate.end })) continue // citation-only material never becomes a node
    // Never duplicate a token already shown inside a canonical slot's own span (e.g. "very"
    // inside a copular complement "very complex") -- B4's visible-duplicate-constituent
    // invariant applies to Tree construction itself, not just presentation.
    if (isWithinAny({ text: candidate.text, start: candidate.start, end: candidate.end }, consumedSpans)) continue
    nodes.push(candidate)
  }
  return byStart(nodes)
}

// ----------------------------------------------------------------------------
// Predicate node assembly -- reuses the canonical converter verbatim for V/IO/O/C.
// ----------------------------------------------------------------------------

function buildPredicateNode(
  frame: PredicateFrame,
  text: string,
  tokens: StanzaToken[],
  byHead: Map<number, StanzaToken[]>,
  boundaryIds: ReadonlySet<number>,
  subjectStart: number,
): { node: StructureTreeNode; opening: StructureTreeNode[] } {
  const converted = convertPredicateFrame(frame, text, tokens, byHead, boundaryIds)
  const headToken = frame.headToken
  const claimed = new Set<number>()

  const slotChildren: StructureTreeNode[] = []
  // Prototype 2.6G2.5B2 item 1: a structural expletive (Stanza deprel `expl`, e.g. "there"
  // in "there is strong covariance...") is built as its OWN dedicated node here -- never the
  // canonical subject (subjToken/subjectNode construction is entirely unaffected), never
  // O/C, and by being added directly to slotChildren (not routed through buildModifierNodes
  // at all) it can never reach the opening-modifier position check, so it can never be
  // mislabeled 'openingModifier' either. Identified purely by dependency role, regardless of
  // the token's own text -- a genuine locative "there" (advmod/obl) never has deprel `expl`
  // and is completely unaffected by this branch.
  const explToken = (byHead.get(headToken.id) ?? []).find((c) => normalizeDep(c.deprel) === 'expl')
  if (explToken) {
    claimed.add(explToken.id)
    slotChildren.push(buildDecomposedConstituentNode('expletive', explToken, byHead, tokens, boundaryIds, text))
  }
  if (frame.iobjToken && converted.indirectObject) {
    claimed.add(frame.iobjToken.id)
    slotChildren.push(buildDecomposedConstituentNode('indirectObject', frame.iobjToken, byHead, tokens, boundaryIds, text))
  }
  if (frame.objToken && converted.object) {
    claimed.add(frame.objToken.id)
    // Any colon-introduced enumeration this object's own head owns (e.g. "two issues: A and
    // B") is discovered automatically inside buildDecomposedConstituentNode now -- no
    // special-cased injection needed here any more (item 6/7 of Prototype 2.6G2.1:
    // enumeration detection is no longer confined to the object slot).
    slotChildren.push(buildDecomposedConstituentNode('object', frame.objToken, byHead, tokens, boundaryIds, text))
  }
  if (frame.cop.length === 0 && converted.complement && frame.objToken) {
    // Object-complement (SVOC): postnominal amod / xcomp complement of the object.
    const postnominal = findPostnominalComplementToken(frame.objToken, byHead)
    const complementHead = postnominal ?? frame.xcompToken ?? frame.objToken
    slotChildren.push(buildDecomposedConstituentNode('complement', complementHead, byHead, tokens, boundaryIds, text))
  } else if (frame.cop.length > 0 && converted.complement) {
    slotChildren.push(buildDecomposedConstituentNode('complement', headToken, byHead, tokens, boundaryIds, text, COPULAR_HEAD_STOP_DEPS))
  } else if (converted.complement && frame.xcompToken) {
    slotChildren.push(buildDecomposedConstituentNode('complement', frame.xcompToken, byHead, tokens, boundaryIds, text))
  }
  if (frame.ccompToken && converted.object && frame.cop.length === 0 && !frame.objToken) {
    // Clausal object (noun clause, e.g. "indicated that X declines") -- the whole clause is
    // the canonical object as one grounded span; it has no further internal decomposition
    // here (the embedded clause's own S/V/O is not this predicate's concern).
    claimed.add(frame.ccompToken.id)
    slotChildren.push(node('object', converted.object, []))
  }

  const consumedSpans: Span[] = [converted.indirectObject, converted.object, converted.complement].filter((s): s is Span => s !== null)
  // Prototype 2.6G2.6C4 Part B item 12-16 -- PREDICATE_INTERNAL_MODIFIER_VISIBLE_DUPLICATION.
  // The predicate node's own displayed `.text` is `converted.verb` -- the CANONICAL V
  // authority span verbatim (frozen, e.g. "were initially selected"/"are merely designed"),
  // never trimmed or narrowed (unlike object/complement/enumeration nodes, this node has no
  // `presentationSpan` mechanism at all). A predicate-internal adverbial modifier
  // (`advmod`, e.g. "initially" sitting between the passive auxiliary and the participle) is
  // therefore ALREADY fully visible inline as part of that same verbatim text -- if
  // `buildModifierNodes` also surfaces it as an independent child, the identical token/span
  // renders twice (live-diagnosed: "were initially selected" -> child "initially"; "are
  // merely designed" -> child "merely"). Fixed via source-span containment, never a lexical
  // word list: any modifier whose own span falls ENTIRELY WITHIN the canonical verb span is
  // excluded from the separate-child set here -- the conservative fallback this phase's own
  // spec prefers over inventing a discontinuous "were [initially] selected" presentation
  // architecture for this one class. A modifier positioned OUTSIDE the verb span (e.g. "as
  // inputs for the model", "for single modalities", any trailing PP) is completely
  // unaffected -- it was never duplicated in the first place, since the verb's own text never
  // included it to begin with.
  const verbSpan = { start: converted.verb?.start ?? frame.headToken.start, end: converted.verb?.end ?? frame.headToken.end }
  const allModifierNodes = buildModifierNodes(headToken, byHead, tokens, text, claimed, consumedSpans).filter(
    (m) => !(m.start >= verbSpan.start && m.end <= verbSpan.end),
  )

  // Opening modifier placement: a predicate-attached modifier whose OWN span ends at or
  // before the clause subject's start is a sentence/clause-level opener ("In this study, ..."
  // ), not an ordinary post-verb modifier -- purely positional (never lexical/case-specific),
  // the same signal the legacy Tree builder already used (structureTree.ts's own Rule 1,
  // `m.end <= core.subject.start`), now ported here. Pulled out and returned separately so
  // the caller can surface it as a top-level sibling instead of nesting it under the
  // predicate it happens to attach to.
  const opening = allModifierNodes.filter((m) => m.end <= subjectStart).map((m) => ({ ...m, role: 'openingModifier' as const }))
  const modifierNodes = allModifierNodes.filter((m) => m.end > subjectStart)

  return {
    node: {
      text: converted.verb?.text ?? '',
      role: converted.relation === 'main' ? 'predicate' : 'coordinatedPredicate',
      start: converted.verb?.start ?? frame.headToken.start,
      end: converted.verb?.end ?? frame.headToken.end,
      children: byStart([...slotChildren, ...modifierNodes]),
    },
    opening,
  }
}

// ----------------------------------------------------------------------------
// Clause node assembly.
// ----------------------------------------------------------------------------

/** Prototype 2.6G2.5B3 item 2/5 -- a clause-introducing marker (if/because/although/when/
 * while/whereas, or an infinitival "to") is now its OWN dedicated node (role 'clause',
 * `.text` grounded to the marker token itself, `.marker` set to the same span for
 * structured metadata access), wrapping the clause's real content as its single child --
 * never baked inline onto the subject/predicate node's own button the way item B10
 * previously did (that made a single button read "if strong covariance..." labelled 主語,
 * conflating the marker with the subject). The marker is visible exactly once (on the
 * wrapper); the wrapped content keeps its own correct role/label (`subject`/`predicate`/
 * etc.), completely unaffected by which marker (if any) introduces it -- one mechanism for
 * every marker word, matching item 5's "unify marker rendering" requirement. Also fixes
 * item 1's false predicate-coordination grouping: a marked subordinate clause's top-level
 * role is now 'clause', never 'subject', so it can no longer be mistaken by
 * coordinationGroupPresentation's role-based grouping for a further coordinated member of
 * the main clause's own subject/predicate run. */
function wrapWithMarker(markerSpan: Span, content: StructureTreeNode): StructureTreeNode {
  return {
    text: markerSpan.text,
    role: 'clause',
    start: markerSpan.start,
    end: markerSpan.end,
    marker: markerSpan,
    children: [content],
  }
}

/** Prototype 2.6G2.6C6 -- Shared Auxiliary Scope Presentation. Grounds `head`'s own direct
 * `aux`/`aux:pass` children (e.g. "were" in "were collected", "has been" in "has been tested",
 * "can be" in "can be applied") as ONE span, sorted by source position -- multi-token
 * auxiliary/modal chains ground as a single contiguous span the same way a multi-word marker
 * or connector already does elsewhere in this file (`spanFromTokens`). Deliberately excludes
 * `cop`: a copular "is"/"was" introduces a predicate-nominal/adjectival COMPLEMENT, not a
 * further coordinated verb phrase, and treating it as shareable auxiliary scope would
 * misrepresent "The model is accurate and predicts..." as "is" governing "predicts". Returns
 * undefined when `head` has no aux/aux:pass child at all -- nothing to share. */
function findSharedAuxiliarySpan(head: StanzaToken, byHead: Map<number, StanzaToken[]>, text: string): Span | undefined {
  const auxTokens = (byHead.get(head.id) ?? []).filter((c) => {
    const dep = normalizeDep(c.deprel)
    return dep === 'aux' || dep === 'aux:pass'
  })
  if (auxTokens.length === 0) return undefined
  return spanFromTokens(text, auxTokens) ?? undefined
}

/** Prototype 2.6G2.6C6A -- extracts the `VerbForm` value (e.g. "Part", "Fin", "Inf") from a
 * raw UD FEATS string (e.g. "Tense=Past|VerbForm=Part|Voice=Pass"). Returns undefined when
 * `feats` is missing/null or carries no VerbForm key -- "no evidence", never a guessed value. */
function verbFormOf(feats: string | null | undefined): string | undefined {
  if (!feats) return undefined
  for (const pair of feats.split('|')) {
    const [key, value] = pair.split('=')
    if (key === 'VerbForm' && value) return value
  }
  return undefined
}

/** Prototype 2.6G2.6C6A -- Shared Auxiliary Morphosyntactic Compatibility Gate. The earlier
 * 2.6G2.6C6 criterion ("later predicate has no auxiliary of its own") is a NECESSARY but not
 * SUFFICIENT condition -- live-diagnosed false positives: "She has visited Paris and LIVES in
 * London" (VerbForm=Fin, a genuinely separate finite clause, not a shared-`has` participle)
 * and "The system was tested and WORKS well" (same class). Absence of a later auxiliary alone
 * cannot distinguish a true non-finite continuation ("collected"/"converted", both
 * VerbForm=Part) from an ordinary finite verb that simply never needed its own auxiliary to
 * begin with. Positive morphosyntactic evidence is required: `laterPredicateHead`'s own
 * VerbForm (from its real UD FEATS, never a suffix/lexical heuristic) must EQUAL
 * `mainPredicateHead`'s own VerbForm -- both VerbForm=Part (passive/perfect participle
 * chains: "were collected"/"converted", "has been tested"/"validated") or both VerbForm=Inf
 * (bare-infinitive modal chains: "can collect"/"analyze"). A later VerbForm=Fin conjunct
 * (its own independent finite clause coordinated only by proximity) never matches a
 * VerbForm=Part or VerbForm=Inf main predicate, correctly blocking every diagnosed negative.
 * When either head's FEATS/VerbForm is unavailable, the comparison is conservatively
 * inconclusive and sharing is withheld (section 5's "false negatives are preferable to
 * falsely teaching that an auxiliary is shared") -- never a fallback guess. */
function sharedAuxiliaryFor(
  laterPredicateHead: StanzaToken,
  mainPredicateHead: StanzaToken,
  byHead: Map<number, StanzaToken[]>,
  mainAuxiliarySpan: Span | undefined,
): boolean {
  if (!mainAuxiliarySpan) return false
  const hasOwnAuxiliary = (byHead.get(laterPredicateHead.id) ?? []).some((c) => {
    const dep = normalizeDep(c.deprel)
    return dep === 'aux' || dep === 'aux:pass'
  })
  if (hasOwnAuxiliary) return false
  const mainVerbForm = verbFormOf(mainPredicateHead.feats)
  const laterVerbForm = verbFormOf(laterPredicateHead.feats)
  if (!mainVerbForm || !laterVerbForm) return false
  return mainVerbForm === laterVerbForm
}

function buildClauseNode(
  clause: ClauseFrame,
  text: string,
  tokens: StanzaToken[],
  byHead: Map<number, StanzaToken[]>,
  byId: Map<number, StanzaToken>,
): { node: StructureTreeNode; opening: StructureTreeNode[] } | null {
  const siblingBoundaryIds = new Set<number>(clause.predicateHeadIds)
  const subjToken = (byHead.get(clause.headTokenId) ?? []).find((c) => normalizeDep(c.deprel) === 'nsubj' || normalizeDep(c.deprel) === 'csubj') ?? null
  // Prototype 2.6G2.5B item B12: a subjectless subordinate clause (infinitival/participial,
  // e.g. "...employed to detect the multicollinearity...") has NO nsubj/csubj by grammatical
  // design (a PRO/implicit subject) -- this used to make buildClauseNode return null,
  // silently discarding the whole clause. `subjectNode` stays null in that case; the
  // predicate(s) below are still built, just not nested under any subject node.
  const subjectNode = subjToken ? buildDecomposedConstituentNode('subject', subjToken, byHead, tokens, siblingBoundaryIds, text) : null
  const subjectStartForOpening = subjectNode ? subjectNode.start : byId.get(clause.headTokenId)!.start

  const opening: StructureTreeNode[] = []
  const predicateNodes = clause.predicateHeadIds.map((headId, idx) => {
    const headToken = byId.get(headId)!
    const frame = buildPredicateFrame(headToken, clause, byHead, idx === 0)
    const built = buildPredicateNode(frame, text, tokens, byHead, siblingBoundaryIds, subjectStartForOpening)
    opening.push(...built.opening)
    // Prototype 2.6G2.6C item 4/6 -- `PredicateFrame.subjToken` (frozen, already computed by
    // the authority layer per-predicate-head, but never previously read anywhere in this
    // Tree module) surfaces a coordinated predicate's OWN distinct subject -- the general
    // "clausal coordination with its own subject per conjunct" shape (e.g. "(1) the SUM is
    // converted ... and the weight of each edge is calculated ...", where "converted" and
    // "calculated" are one ClauseFrame's coordinated predicateHeadIds via `conj`, yet each
    // has its own separate `nsubj` -- Stanza's own valid UD pattern for coordinate clauses
    // joined without a repeated subject pronoun). Never fires for the far more common SHARED-
    // subject coordination ("is stable and is durable"): there, only the first predicate has
    // its own nsubj child, so every later frame.subjToken is null and this is a no-op.
    const ownSubjToken = idx > 0 && frame.subjToken && frame.subjToken.id !== subjToken?.id ? frame.subjToken : null
    return { node: built.node, ownSubjToken, headToken }
  })

  // Prototype 2.6G2.6C6 -- Shared Auxiliary Scope Presentation. The FIRST predicate's own
  // aux/aux:pass children (never `cop` -- a copular "is"/"was" introduces a predicate-
  // nominal/adjectival complement, not a further coordinated VERB, and merging it here would
  // wrongly imply e.g. "is" governs "predicts" in "The model is accurate and predicts...",
  // where "predicts" is conj of the ADJ root "accurate", not a genuine passive/perfect/modal
  // continuation) are the candidate SHARED scope for a later same-subject coordinated
  // predicate that has no auxiliary of its own -- see `sharedAuxiliaryFor` below for the
  // full per-predicate eligibility check.
  const mainPredicateHead = byId.get(clause.predicateHeadIds[0]!)!
  const mainAuxiliarySpan = findSharedAuxiliarySpan(mainPredicateHead, byHead, text)

  // Connectors between coordinated predicates are carried as structured `connector` metadata
  // (Prototype 2.6G2.2 item 2) so "and is influenced" style coordination keeps its own
  // conjunction visible, WITHOUT baking it into the node's own text/presentationSpan -- that
  // used to collide with the separate, pre-existing sibling-level coordination-group
  // renderer (coordinationGroupPresentation.ts), which independently detects the same
  // same-family predicate run and shows its own connector badge, producing a visible
  // duplicate ("and" / "and is influenced"). `connector` is the single source of truth;
  // StructureTreeView is responsible for rendering it in exactly one place. Mirrors the
  // canonical connector already computed for SentenceCoreSet.predicateCores.
  let previousVerbEnd = subjectNode ? subjectNode.end : predicateNodes[0]?.node.start ?? 0
  const predicateNodesWithConnectors = predicateNodes.map(({ node: predNode, ownSubjToken, headToken }, idx) => {
    if (idx === 0) {
      previousVerbEnd = predNode.end
      return predNode
    }
    const connector = connectorSpan(text, previousVerbEnd, predNode.start)
    previousVerbEnd = predNode.end
    // Prototype 2.6G2.6C item 4/6: when this coordinated predicate has its own distinct
    // subject, present it as its own subject -> predicate unit (a SIBLING mini-clause under
    // the outer clause subject, matching the target shape's "the weight of each edge / is
    // calculated" pairing) instead of a bare predicate hanging directly off the clause's
    // shared subject -- the connector moves to this new wrapper (still rendered exactly
    // once, on whichever node is now the actual coordinated sibling).
    if (ownSubjToken) {
      const ownSubjectNode = buildDecomposedConstituentNode('subject', ownSubjToken, byHead, tokens, siblingBoundaryIds, text)
      ownSubjectNode.children = byStart([...ownSubjectNode.children, predNode])
      return connector ? { ...ownSubjectNode, connector } : ownSubjectNode
    }
    // Prototype 2.6G2.6C6 -- this predicate inherits the main predicate's auxiliary scope
    // ONLY when it has no auxiliary of its own (see `sharedAuxiliaryFor`'s own doc comment
    // for the full false-positive audit -- e.g. "has finished... will write" never shares,
    // since "write" owns its own `aux` "will"). Never fires without `mainAuxiliarySpan`
    // (nothing to inherit) or without an eligible predicate (ownSubjToken already excludes
    // Class B clause coordination above).
    const withSharedAuxiliary = sharedAuxiliaryFor(headToken, mainPredicateHead, byHead, mainAuxiliarySpan)
      ? { ...predNode, sharedAuxiliarySpan: mainAuxiliarySpan }
      : predNode
    if (!connector) return withSharedAuxiliary
    return { ...withSharedAuxiliary, connector }
  })

  // Prototype 2.6G2.5B item B10 (restructured 2.6G2.5B3 item 2/5): a clause-introducing
  // marker (if/because/although/when/while/whereas/an infinitival "to") is captured by
  // ClauseFrame.marker -- now wrapped via wrapWithMarker (see its own doc comment) instead
  // of being stamped inline onto the subject/predicate node itself.
  const markerSpan: Span | undefined = clause.marker ? { text: clause.marker.text, start: clause.marker.start, end: clause.marker.end } : undefined

  // Prototype 2.6G2.6C5 -- CLASS B: explicit-subject clause coordination. When a later
  // coordinated predicate has its OWN distinct subject (`ownSubjToken`, detected above), this
  // ClauseFrame is genuine CLAUSE coordination ("Landslide inventories are..., and THEY
  // directly affect..."), not predicate coordination sharing one subject (CLASS D, "were
  // collected and converted and cropped"). The plain `subjectNode.children = [...predicates]`
  // nesting further below is correct ONLY for Class D -- applying it here would make the
  // second clause's own subject ("they") a DESCENDANT of the first clause's subject
  // ("Landslide inventories"), which is structurally wrong: the two clauses are coordinate
  // SIBLINGS, not one nested inside the other. Detected once, before the shared-subject
  // branch below.
  const hasExplicitSubjectCoordination = predicateNodes.some((p, idx) => idx > 0 && p.ownSubjToken)
  if (subjectNode && hasExplicitSubjectCoordination) {
    // Partition predicateNodesWithConnectors into coordinate BRANCHES: the main subject
    // starts branch 0; each own-subject wrapper (already built above by the ownSubjToken
    // handling, complete with its own nested predicate and `.connector`) starts a NEW branch;
    // any predicate WITHOUT its own subject attaches to the most recently opened branch's
    // subject (natural English: "A does X, and does Y, and B does Z" -- Y attaches to A, Z
    // starts B's own branch).
    const branches: StructureTreeNode[] = []
    let currentBranchSubject = subjectNode
    let currentBranchPredicates: StructureTreeNode[] = []
    for (let idx = 0; idx < predicateNodesWithConnectors.length; idx++) {
      const item = predicateNodesWithConnectors[idx]!
      const startsNewBranch = idx > 0 && Boolean(predicateNodes[idx]!.ownSubjToken)
      if (startsNewBranch) {
        currentBranchSubject.children = byStart([...currentBranchSubject.children, ...currentBranchPredicates])
        branches.push(currentBranchSubject)
        currentBranchSubject = item // already a 'subject'-role wrapper with its own predicate nested + connector
        currentBranchPredicates = []
      } else {
        currentBranchPredicates.push(item)
      }
    }
    currentBranchSubject.children = byStart([...currentBranchSubject.children, ...currentBranchPredicates])
    branches.push(currentBranchSubject)

    // Structural container only -- deliberately empty own text (same "no duplicate lexical
    // row" convention already used for a subjectless multi-predicate clause container below),
    // never a re-statement of what the branch children already show in full.
    // Zero-width, not spanning the branches' own full range: this container's own `.text` is
    // deliberately empty (its content is entirely shown by the branch children below it), and
    // the codebase-wide Span self-consistency contract (`node.text === source.slice(node.start,
    // node.end)`) requires an empty text to pair with an empty (zero-width) range, never a wide
    // one that would slice back to non-empty source text. `.start` still anchors this node at
    // the coordination's own leading position for sorting/positional purposes.
    const coordinationStart = Math.min(...branches.map((b) => b.start))
    const coordinationNode: StructureTreeNode = {
      text: '',
      role: 'clause',
      start: coordinationStart,
      end: coordinationStart,
      children: byStart(branches),
    }
    return { node: markerSpan ? wrapWithMarker(markerSpan, coordinationNode) : coordinationNode, opening }
  }

  if (subjectNode) {
    // Prototype 2.6G2.6B item 8/9/10 -- existential presentation ordering: for a single-
    // predicate clause whose predicate carries an `expl` (structurally identified, never by
    // token text -- see buildPredicateNode's own expletive construction), the grammatically-
    // encoded "subject -> predicate -> expletive" nesting this module otherwise always uses
    // is pedagogically backwards for a reader's actual English surface reading ("if THERE IS
    // strong covariance...", not "if [strong covariance] IS there"). This is PRESENTATION
    // ONLY: the expletive/predicate/subject nodes themselves are the exact same already-built
    // objects (same authority text/start/end/role for every one of them, same marker
    // wrapping) -- only which one nests inside which, for display, changes. `there`/`is`/the
    // subject each still appear exactly once; `there` keeps its own 'expletive' role (never
    // 前置き, never promoted to O/C). Scoped to the single-predicate case only -- a
    // coordinated-predicate existential clause is rare enough, and structurally different
    // enough (multiple verbs would each need their own reordering decision), to leave using
    // the ordinary subject-wraps-predicate nesting rather than risk an ad hoc rule for it.
    if (predicateNodesWithConnectors.length === 1) {
      const onlyPredicate = predicateNodesWithConnectors[0]!
      const expletiveChild = onlyPredicate.children.find((c) => c.role === 'expletive')
      if (expletiveChild) {
        const predicateWithSubject: StructureTreeNode = {
          ...onlyPredicate,
          children: byStart([...onlyPredicate.children.filter((c) => c !== expletiveChild), subjectNode]),
        }
        const existentialNode: StructureTreeNode = { ...expletiveChild, children: [predicateWithSubject] }
        return { node: markerSpan ? wrapWithMarker(markerSpan, existentialNode) : existentialNode, opening }
      }
    }
    subjectNode.children = byStart([...subjectNode.children, ...predicateNodesWithConnectors])
    return { node: markerSpan ? wrapWithMarker(markerSpan, subjectNode) : subjectNode, opening }
  }

  // No overt subject: retain the predicate(s) instead of discarding the whole clause (item
  // B12 -- "Tree must retain it"). Never O/C: nothing built here is ever treated as an
  // object/complement slot anywhere else in this module.
  if (predicateNodesWithConnectors.length === 0) return null

  // Prototype 2.6G2.5B3 item 4: a single subjectless predicate needs no separate 'clause'
  // container at all -- returning it directly (optionally wrapped in its own marker, e.g.
  // "to detect...") avoids ever showing a wrapper's own full-span text ALONGSIDE its own
  // single child's identical content, which is exactly the "STRUCTURAL CONTAINER = duplicate
  // lexical row" bug item 4 flagged (the old wrapper's text always equalled the predicate's
  // own text here, since nothing else was ever inside it).
  if (predicateNodesWithConnectors.length === 1) {
    const only = predicateNodesWithConnectors[0]!
    return { node: markerSpan ? wrapWithMarker(markerSpan, only) : only, opening }
  }

  // Multiple coordinated subjectless predicates: still need one container to hold them, but
  // its own text is deliberately empty (never a duplicate re-statement of what the predicate
  // children already show) -- StructureTreeView renders no separate text row for an
  // empty-text node, only the marker (if any) and the real children below it.
  const clauseStart = Math.min(...predicateNodesWithConnectors.map((n) => n.start))
  const clauseEnd = Math.max(...predicateNodesWithConnectors.map((n) => n.end))
  const clauseNode: StructureTreeNode = {
    text: '',
    role: 'clause',
    start: clauseStart,
    end: clauseEnd,
    children: byStart(predicateNodesWithConnectors),
  }
  return { node: markerSpan ? wrapWithMarker(markerSpan, clauseNode) : clauseNode, opening }
}

// ----------------------------------------------------------------------------
// Prototype 2.6G2.5B2 items 3/4 -- recursive clause ownership + paratactic/semicolon
// sibling-clause discovery. Every ClauseFrame must reach a deterministic fate: rendered
// (nested at its true depth, or as a coordinate sibling), or documented as intentionally
// absorbed elsewhere (acl/ccomp/csubj-based 'other' clauses, already handled by
// buildDecomposedConstituentNode's own postmodifier/object-slot logic). None of this touches
// stanzaSyntaxAuthority.ts/ClauseFrame/SentenceCoreSet -- presentation-only completion of
// the SAME frozen clause data.
// ----------------------------------------------------------------------------

/**
 * A conj-attached clause-like verb whose link to `anchorHeadId` crosses a semicolon in the
 * source text is deliberately excluded from the anchor's own `predicateHeadIds` by the
 * frozen `collectCoordinatedPredicates` (a semicolon-separated conjunct is a further
 * coordinate clause, never a further coordinated action of the same clause's own subject) --
 * but a bare `conj` deprel is not itself a clause-starting deprel, so such a token never
 * gets its own ClauseFrame either. Discovered here using the exact same semicolon-gap signal
 * the frozen function already uses (never a new classification rule, never re-deriving
 * grammar Stanza didn't already provide).
 */
function findSemicolonSiblingHeads(anchorHeadId: number, byHead: Map<number, StanzaToken[]>, byId: Map<number, StanzaToken>, text: string): StanzaToken[] {
  const anchor = byId.get(anchorHeadId)
  if (!anchor) return []
  const found: StanzaToken[] = []
  let previousEnd = anchor.end
  const conjChildren = (byHead.get(anchorHeadId) ?? [])
    .filter((c) => normalizeDep(c.deprel) === 'conj' && isPredicateLikeToken(c, byHead))
    .sort((a, b) => a.start - b.start)
  for (const child of conjChildren) {
    if (text.slice(previousEnd, child.start).includes(';')) found.push(child)
    previousEnd = child.end
  }
  return found
}

/** A minimal synthetic ClauseFrame for a semicolon-sibling clause head that never received
 * an official one from `buildClauseFrames` (bare `conj` is not a clause-starting deprel).
 * Exists only for this module's own `buildClauseNode` call -- never registered in
 * stanzaSyntaxAuthority.ts, ClauseFrame, or SentenceCoreSet. */
function syntheticParataxisClause(head: StanzaToken, parentHeadId: number, byHead: Map<number, StanzaToken[]>): ClauseFrame {
  return {
    clauseId: head.id,
    relation: 'other',
    headTokenId: head.id,
    parentClauseId: parentHeadId,
    marker: (byHead.get(head.id) ?? []).find((c) => normalizeDep(c.deprel) === 'mark') ?? null,
    predicateHeadIds: [head.id],
  }
}

/** Direct paratactic/coordinate sibling clauses anchored at `anchorHeadId`: (a) an OFFICIAL
 * ClauseFrame whose own raw deprel is `parataxis` (`buildClauseFrames` already creates these
 * -- `classifyClauseRelation`'s 'other' bucket also covers acl/ccomp/csubj, which are
 * excluded here since those are already handled elsewhere: acl as an NP postmodifier, ccomp
 * as a clausal object, csubj as a clausal subject -- deliberately narrow, matching "generic
 * but correct"), and (b) a semicolon-crossing conj sibling with no official ClauseFrame at
 * all (see findSemicolonSiblingHeads). */
function findParataticSiblingClauses(
  anchorHeadId: number,
  clauses: readonly ClauseFrame[],
  byHead: Map<number, StanzaToken[]>,
  byId: Map<number, StanzaToken>,
  text: string,
): ClauseFrame[] {
  const siblings: ClauseFrame[] = []
  for (const clause of clauses) {
    if (clause.parentClauseId !== anchorHeadId) continue
    const head = byId.get(clause.headTokenId)
    if (head && normalizeDep(head.deprel) === 'parataxis') siblings.push(clause)
  }
  for (const head of findSemicolonSiblingHeads(anchorHeadId, byHead, byId, text)) {
    siblings.push(syntheticParataxisClause(head, anchorHeadId, byHead))
  }
  return siblings.sort((a, b) => byId.get(a.headTokenId)!.start - byId.get(b.headTokenId)!.start)
}

/** Transitively collects every paratactic/coordinate clause reachable from `anchorHeadId`
 * through a CHAIN of paratactic siblings (e.g. a 4-item semicolon list where each item
 * attaches to either the true root or the PREVIOUS item -- both shapes observed in real
 * corpus data), flattened into one ordered list -- these are coordinate/parallel items, not
 * nested inside one another merely because of which specific token Stanza's own parse
 * happened to anchor the next item to. Own local dedup; never mutates the caller's `visited`
 * (that happens only when a clause actually gets BUILT, in buildClauseSubtree). */
function collectAllParataticClauses(
  anchorHeadId: number,
  clauses: readonly ClauseFrame[],
  byHead: Map<number, StanzaToken[]>,
  byId: Map<number, StanzaToken>,
  text: string,
): ClauseFrame[] {
  const result: ClauseFrame[] = []
  const seen = new Set<number>()
  const queue = [...findParataticSiblingClauses(anchorHeadId, clauses, byHead, byId, text)]
  while (queue.length > 0) {
    const sibling = queue.shift()!
    if (seen.has(sibling.clauseId)) continue
    seen.add(sibling.clauseId)
    result.push(sibling)
    queue.push(...findParataticSiblingClauses(sibling.headTokenId, clauses, byHead, byId, text))
  }
  return result.sort((a, b) => byId.get(a.headTokenId)!.start - byId.get(b.headTokenId)!.start)
}

/** Builds one clause's own node AND recursively attaches every subordinate clause whose
 * `parentClauseId` is genuinely this clause (item 3: "every ClauseFrame must be reachable
 * through its parentClauseId chain" -- nested arbitrarily deep, never promoted to the
 * sentence top level, never flattened into the clause it's nested under). `visited` is
 * shared across the whole tree build so a clause is only ever built once, from wherever it's
 * first reached; `nodesByClauseId` records the built node under its own clauseId (mutated
 * here, read by the deep-nesting fallback pass) so a later orphaned clause can be grafted
 * onto the correct already-built node WITHOUT a fragile span-based search of the tree. */
function buildClauseSubtree(
  clause: ClauseFrame,
  clauses: readonly ClauseFrame[],
  text: string,
  tokens: StanzaToken[],
  byHead: Map<number, StanzaToken[]>,
  byId: Map<number, StanzaToken>,
  visited: Set<number>,
  nodesByClauseId: Map<number, StructureTreeNode>,
): StructureTreeNode | null {
  if (visited.has(clause.clauseId)) return null
  visited.add(clause.clauseId)
  const built = buildClauseNode(clause, text, tokens, byHead, byId)
  if (!built) return null
  let children = built.opening.length > 0 ? byStart([...built.node.children, ...built.opening]) : built.node.children

  const extra: StructureTreeNode[] = []
  for (const child of clauses) {
    if (child.relation !== 'subordinate') continue
    if (child.parentClauseId !== clause.clauseId) continue
    if (visited.has(child.clauseId)) continue
    const node = buildClauseSubtree(child, clauses, text, tokens, byHead, byId, visited, nodesByClauseId)
    if (node) extra.push(node)
  }
  if (extra.length > 0) children = byStart([...children, ...extra])

  const finalNode = { ...built.node, children }
  nodesByClauseId.set(clause.clauseId, finalNode)
  return finalNode
}

/** Prototype 2.6G2.5B2 item 3 (deep-nesting fallback): `stanzaSyntaxAuthority.ts`'s own
 * `anchorClauseHead` only walks a PURE `conj` chain to find a clause anchor -- by design, so
 * it stays conservative for SentenceCoreSet's own subordinate/relative distinction. A clause
 * whose immediate syntactic parent is neither a registered clause head nor a pure conj link
 * (e.g. an `advcl` attached to an ADJ via `amod`, itself several NP hops from any clause
 * head) gets `parentClauseId = null` even though it is genuinely nested several levels below
 * a real clause, not a top-level sentence element. This is a presentation-only, best-effort
 * walk of the RAW head chain (never touching ClauseFrame.parentClauseId, never affecting
 * SentenceCoreSet) used ONLY to decide where an orphaned clause should be nested for
 * DISPLAY when the frozen anchor resolution came back null or unreachable.
 */
function nearestKnownClauseAncestor(token: StanzaToken, byId: Map<number, StanzaToken>, knownClauseHeadIds: ReadonlySet<number>): number | null {
  let current: StanzaToken | undefined = byId.get(token.head)
  let guard = 0
  while (current && guard < 64) {
    if (knownClauseHeadIds.has(current.id)) return current.id
    current = byId.get(current.head)
    guard += 1
  }
  return null
}

/** Prototype 2.6G2.6C3 Part B item 13 -- finds the already-built 'predicate'/'coordinatedPredicate'
 * node whose own span contains `tokenStart` (a specific predicate head token's own position),
 * searching the WHOLE subtree (not just direct children) since a per-conjunct-subject-wrapped
 * coordinated predicate (Prototype 2.6G2.6C's own "own distinct subject" mechanism) nests its
 * `coordinatedPredicate` node one level deeper, inside a synthesized subject wrapper. */
function findPredicateNodeContaining(nodes: StructureTreeNode[], tokenStart: number): StructureTreeNode | null {
  for (const n of nodes) {
    if ((n.role === 'predicate' || n.role === 'coordinatedPredicate') && tokenStart >= n.start && tokenStart < n.end) return n
    const found = findPredicateNodeContaining(n.children, tokenStart)
    if (found) return found
  }
  return null
}

/**
 * Pure function: Stanza tokens -> full hierarchical StructureTreeNode[] (preserves clause
 * scope, never flattens every verb into one global list). Returns [] when no main clause can
 * be found (mirrors buildCoreOnlyTree/buildHybridStructureTree's own empty-array failure
 * convention -- callers already handle an empty tree as "nothing to show").
 */
/**
 * Prototype 2.6G2.6C item 4/5/6/7/8 -- structures ONE enumeration item's internal content
 * using already-existing Stanza/ClauseFrame/PredicateFrame authority found within the
 * item's own source span, instead of leaving it as flat surface-recovered text.
 *
 * Two kinds of authority are gathered, both purely via source-span containment (never text
 * splitting, never re-deriving grammar):
 * 1. Individual predicate HEADS (from any ClauseFrame's own `predicateHeadIds`) whose own
 *    token falls inside the item's span. A numbered list's items frequently suffer UD
 *    coordination-attachment drift across item boundaries (already diagnosed in earlier
 *    phases): all of an item's own predicates can end up coordinated into ONE ClauseFrame
 *    that spans past a single item's own boundary (confirmed live: "converted"/"calculated"/
 *    "established" from a real two-item KNN/GCN control are ALL one ClauseFrame's
 *    predicateHeadIds via `conj`, even though "established" belongs to the SECOND item).
 *    Matching per PREDICATE HEAD position (not per whole ClauseFrame) is what correctly
 *    splits such a drifted clause back across the item boundaries it actually respects in
 *    the source text. Each matched head is built as its own subject+predicate unit via the
 *    exact same frozen `PredicateFrame.subjToken` mechanism `buildClauseNode` now uses
 *    (2.6G2.6C item 4/6) -- a predicate whose OWN direct child supplies a distinct subject
 *    gets it; one that doesn't (a bare coordinated predicate with no subject of its own)
 *    stays a bare predicate unit, never a guessed/invented subject.
 * 2. Subordinate/paratactic ClauseFrames whose own head falls inside the item's span and
 *    are not yet `visited` -- captured as their own additional sibling unit via the SAME
 *    `buildClauseSubtree` recursion used at the sentence level, so a modifier clause like
 *    "based on the distances" is still represented, not silently dropped, even though
 *    `buildModifierNodes` deliberately never attaches an advcl/acl (clause-starting deprels
 *    are always left for clause-assembly level to handle -- see that function's own comment).
 *
 * If NEITHER kind of authority is found inside the item's own span, the item is returned
 * completely unchanged (item 8's flat fallback): "reliable internal authority available ->
 * structured item; not available -> flat item" -- never manufacturing structure merely
 * because a surface marker like "(1)" was found.
 *
 * B4 discipline: `item.text`/`.start`/`.end` (full raw span, e.g. "(1) the SUM is converted
 * ...") remain the item's own AUTHORITY, completely unchanged. Only `.presentationSpan`
 * (reduced to the leading "(1)"-style marker, or empty text when no marker prefix exists)
 * and `.children` (the newly discovered structure) are added -- the marker is never turned
 * into its own grammar S/V/O/C node, and the item's own row never repeats text its children
 * already show (no visible duplication).
 */
function structureEnumerationItem(
  item: StructureTreeNode,
  clauses: readonly ClauseFrame[],
  tokens: StanzaToken[],
  byHead: Map<number, StanzaToken[]>,
  byId: Map<number, StanzaToken>,
  text: string,
  visited: Set<number>,
  nodesByClauseId: Map<number, StructureTreeNode>,
): StructureTreeNode {
  const usedHeadIds = new Set<number>()
  const touchedClauseIds = new Set<number>()
  const candidates: { clause: ClauseFrame; headId: number; token: StanzaToken }[] = []
  for (const clause of clauses) {
    // Prototype 2.6G2.6C item 6 bugfix: a SUBORDINATE clause's own predicateHeadIds is just
    // itself (e.g. clause 18 "using" -> predicateHeadIds=[18]) -- without this filter it was
    // being harvested here as its own flat top-level candidate (and thus marked `visited`
    // below via `touchedClauseIds`) BEFORE the governing-predicate nesting loop further down
    // ever got a chance to see it, silently defeating that nesting logic entirely. Only
    // 'other'-relation clauses (whose predicateHeadIds legitimately span coordinated
    // predicate heads like [14,29,44], anchored under the main clause via a colon+list
    // structure) are harvested as item-level sibling units here; subordinate clauses are
    // handled exclusively by the loop below. The sentence's own MAIN clause is also excluded
    // here even though its relation can otherwise pass this filter: it is unconditionally
    // built once, independently, by buildClauseNode before this function ever runs -- letting
    // it through here does not create a genuine list item, it just re-decomposes the exact
    // same predicate head(s) a second time, producing an EXACT (role, span, text) duplicate
    // node (caught live via the d48-mixed-three-patterns regression: "The product is
    // operational, detects rapid changes, and is distributed through an open portal" --
    // Stanza attaches "detects"/"is distributed" via conj to the complement "operational",
    // which the constituent-decomposition code separately -- and correctly, for genuine lists
    // -- surfaces as its own 'enumeration' child; without this exclusion this function then
    // re-built "detects"/"is distributed" a second time inside that spurious wrapper).
    if (clause.relation === 'subordinate' || clause.relation === 'main') continue
    for (const headId of clause.predicateHeadIds) {
      const token = byId.get(headId)
      if (!token) continue
      if (token.start >= item.start && token.end <= item.end) candidates.push({ clause, headId, token })
    }
  }
  candidates.sort((a, b) => a.token.start - b.token.start)

  const units: StructureTreeNode[] = []
  // Maps a claimed predicate head's own token id to the ACTUAL predicate-role node object
  // built for it (a mutable reference, not a copy) -- used below to nest a subjectless
  // subordinate clause that directly modifies this specific predicate (e.g. "using the KNN
  // method", "based on the distances") as an ordinary 'modifier' child of it, matching the
  // target shape's own nesting, instead of a flat item-level sibling.
  const predicateNodeByHeadId = new Map<number, StructureTreeNode>()
  for (const { clause, headId, token } of candidates) {
    if (usedHeadIds.has(headId)) continue
    usedHeadIds.add(headId)
    touchedClauseIds.add(clause.clauseId)
    const isFirst = clause.predicateHeadIds[0] === headId
    const frame = buildPredicateFrame(token, clause, byHead, isFirst)
    const siblingBoundaryIds = new Set<number>(clause.predicateHeadIds)
    const built = buildPredicateNode(frame, text, tokens, byHead, siblingBoundaryIds, item.start)
    predicateNodeByHeadId.set(headId, built.node)
    if (frame.subjToken) {
      const subjectNode = buildDecomposedConstituentNode('subject', frame.subjToken, byHead, tokens, siblingBoundaryIds, text)
      subjectNode.children = byStart([...subjectNode.children, built.node])
      units.push(subjectNode)
    } else {
      units.push(built.node)
    }
  }

  // Every ClauseFrame that contributed at least one predicate head above is now fully
  // represented inside this item -- marked visited so the sentence-level subordinate/
  // paratactic/deep-nesting loops never also build it as a separate top-level sibling.
  for (const clauseId of touchedClauseIds) visited.add(clauseId)

  for (const clause of clauses) {
    if (visited.has(clause.clauseId)) continue
    if (clause.relation !== 'subordinate' && clause.relation !== 'other') continue
    const headToken = byId.get(clause.headTokenId)
    if (!headToken) continue
    if (!(headToken.start >= item.start && headToken.end <= item.end)) continue

    // Prototype 2.6G2.6C item 6: a SUBJECTLESS clause (no nsubj/csubj of its own -- a
    // reduced/non-finite adverbial like "using the KNN method", not a genuine independent
    // mini-clause) that raw-attaches DIRECTLY to one of this item's own already-built
    // predicate heads is nested as an ordinary 'modifier' child of that specific predicate,
    // reusing the same general decomposition every other oblique/adverbial modifier gets --
    // never a guessed subject, never promoted to a flat item-level sibling. A clause that
    // DOES have its own subject (a genuine mini-clause, e.g. an "if there is..." condition)
    // falls through to the sibling-unit path below instead, matching the established
    // sentence-level precedent for such clauses.
    const hasOwnSubject = (byHead.get(clause.headTokenId) ?? []).some((c) => {
      const d = normalizeDep(c.deprel)
      return d === 'nsubj' || d === 'csubj'
    })
    const governingPredicateNode = !hasOwnSubject ? predicateNodeByHeadId.get(headToken.head) : undefined
    if (governingPredicateNode) {
      visited.add(clause.clauseId)
      const owningClause = clauses.find((c) => c.predicateHeadIds.includes(headToken.head))
      const siblingBoundaryIds = owningClause ? new Set<number>(owningClause.predicateHeadIds) : new Set<number>()
      const modifierNode = buildDecomposedConstituentNode('modifier', headToken, byHead, tokens, siblingBoundaryIds, text)
      governingPredicateNode.children = byStart([...governingPredicateNode.children, modifierNode])
      continue
    }

    const node = buildClauseSubtree(clause, clauses, text, tokens, byHead, byId, visited, nodesByClauseId)
    if (node) units.push(node)
  }

  if (units.length === 0) return item // item 8: no reliable internal authority -- flat fallback, unchanged

  const markerMatch = /^\(\s*\d{1,2}\s*\)/.exec(item.text)
  const presentationSpan: Span = markerMatch
    ? { text: markerMatch[0], start: item.start, end: item.start + markerMatch[0].length }
    : { text: '', start: item.start, end: item.start }

  let previousEnd = item.start
  const sortedUnits = byStart(units)
  const unitsWithConnectors = sortedUnits.map((unit, idx) => {
    if (idx === 0) {
      previousEnd = unit.end
      return unit
    }
    const connector = connectorSpan(text, previousEnd, unit.start)
    previousEnd = unit.end
    return connector ? { ...unit, connector } : unit
  })

  return { text: item.text, role: item.role, start: item.start, end: item.end, presentationSpan, children: unitsWithConnectors }
}

/** Walks the tree looking for 'enumeration' container nodes and structures each of their own
 * flat item children in place (post-order, so an enumeration nested inside an already-
 * structured item is handled too). Mutates in place; every other node is left untouched. */
function structureEnumerationItemsInTree(
  nodes: StructureTreeNode[],
  clauses: readonly ClauseFrame[],
  tokens: StanzaToken[],
  byHead: Map<number, StanzaToken[]>,
  byId: Map<number, StanzaToken>,
  text: string,
  visited: Set<number>,
  nodesByClauseId: Map<number, StructureTreeNode>,
): void {
  for (const node of nodes) {
    structureEnumerationItemsInTree(node.children, clauses, tokens, byHead, byId, text, visited, nodesByClauseId)
    if (node.role !== 'enumeration') continue
    node.children = node.children.map((item) => structureEnumerationItem(item, clauses, tokens, byHead, byId, text, visited, nodesByClauseId))
  }
}

/**
 * Prototype 2.6G2.6C (Generalized Tree Presentation Completion) Problem E -- cross-type
 * visible-ownership duplication. A subordinate clause (`advcl`, ClauseFrame relation
 * 'subordinate') attached directly to a token that is ALSO the head of a canonical-slot
 * postmodifier child (e.g. a copular complement's own `advcl`, "capable" -> "of capturing
 * ...") was previously shown TWICE: once as inert flat text inside the postmodifier leaf
 * (`buildDecomposedConstituentNode`'s postmodifier scan only grounds a span/text -- it never
 * invokes the full ClauseFrame/PredicateFrame machinery), and again as a fully-structured
 * standalone top-level 'clause' sibling (built later by the ordinary sentence-level
 * subordinate-clause loop below, which has no visibility into what the postmodifier scan
 * already rendered as flat text for the exact same source span).
 *
 * Walks the already-built tree for a childless 'postmodifier' leaf whose own span contains an
 * as-yet-unvisited 'subordinate'-relation ClauseFrame's own head token, and -- if found --
 * rebuilds that leaf's content using the SAME `buildClauseSubtree` recursion the sentence
 * level uses for a genuinely top-level subordinate clause (which itself already recurses into
 * any further-nested subordinate clauses and marks each one `visited`), then marks it visited
 * so the ordinary sentence-level loop skips it entirely -- source-span containment +
 * ClauseFrame relation/ownership only, never text matching, never sentence-specific.
 *
 * Deliberately restricted to relation 'subordinate' (never 'other'): only 'subordinate' is
 * ever independently re-surfaced by the sentence-level top-level loop below (it explicitly
 * filters `clause.relation !== 'subordinate'`), so only 'subordinate' carries the actual
 * duplication risk this fix closes. A reduced/non-finite postmodifier registered with
 * relation 'other' (e.g. a bare `acl` like "optimized with balanced samples") is never
 * independently duplicated anywhere else and is deliberately left exactly as it already is
 * (flat, per the established "numbered/embedded does not imply parseable structure" fallback
 * principle) -- this fix targets the proven duplication class only, not a general "always
 * deepen every postmodifier" rule.
 *
 * Runs before the sentence-level subordinate loop for the same reason the enumeration-item
 * structuring pass does (see structureEnumerationItemsInTree): whatever this pass claims via
 * `visited` must already be marked before that loop looks for its own top-level candidates.
 */
function attachInternalSubordinateClausesInTree(
  nodes: StructureTreeNode[],
  clauses: readonly ClauseFrame[],
  tokens: StanzaToken[],
  byHead: Map<number, StanzaToken[]>,
  byId: Map<number, StanzaToken>,
  text: string,
  visited: Set<number>,
  nodesByClauseId: Map<number, StructureTreeNode>,
): void {
  for (const node of nodes) {
    attachInternalSubordinateClausesInTree(node.children, clauses, tokens, byHead, byId, text, visited, nodesByClauseId)
    if (node.role !== 'postmodifier' || node.children.length > 0) continue
    const clause = clauses.find((c) => {
      if (c.relation !== 'subordinate') return false
      if (visited.has(c.clauseId)) return false
      const headToken = byId.get(c.headTokenId)
      if (!headToken) return false
      return headToken.start >= node.start && headToken.end <= node.end
    })
    if (!clause) continue
    const built = buildClauseSubtree(clause, clauses, text, tokens, byHead, byId, visited, nodesByClauseId)
    if (!built) continue
    // B4 discipline: the postmodifier's own authority text/span (the full raw span) stays
    // completely unchanged; only presentationSpan (emptied, since `built` now represents the
    // content) and children (the single newly-built real clause node) are added -- matching
    // exactly the same authority/presentation/children split `structureEnumerationItem` uses.
    node.presentationSpan = { text: '', start: node.start, end: node.start }
    node.children = [built]
  }
}

export function buildStanzaHierarchicalTree(text: string, rawTokens: StanzaToken[]): StructureTreeNode[] {
  const tokens = rawTokens
  const byHead = childrenByHead(tokens)
  const byId = new Map(tokens.map((t) => [t.id, t]))
  const clauses = buildClauseFrames(text, tokens, byHead)
  const mainClause = clauses.find((c) => c.relation === 'main')
  if (!mainClause) return []

  const visited = new Set<number>([mainClause.clauseId])
  const nodesByClauseId = new Map<number, StructureTreeNode>()
  const mainResult = buildClauseNode(mainClause, text, tokens, byHead, byId)
  if (!mainResult) return []
  const mainNode = mainResult.node
  const mainOpeningModifiers = mainResult.opening
  nodesByClauseId.set(mainClause.clauseId, mainNode)

  // Prototype 2.6G2.6C item 4/5/6 -- structure every enumeration item's own internal content
  // (see structureEnumerationItem's own doc comment) BEFORE the sentence-level subordinate/
  // paratactic/deep-nesting loops below run, so every ClauseFrame it successfully attaches
  // is already `visited` by the time those loops look for top-level candidates -- the single
  // ownership mechanism already in place (the `visited` set, threaded through this whole
  // build) is reused as-is, never a second parallel bookkeeping structure.
  structureEnumerationItemsInTree([mainNode], clauses, tokens, byHead, byId, text, visited, nodesByClauseId)

  // Prototype 2.6G2.6C Problem E -- absorb any subordinate clause hanging off a canonical-slot
  // postmodifier leaf (e.g. a copular complement's own advcl, "capable" -> "of capturing...")
  // as real structured content under that SAME leaf, before the sentence-level subordinate
  // loop below gets a chance to also build it as an independent top-level sibling (see
  // attachInternalSubordinateClausesInTree's own doc comment for the full diagnosis).
  attachInternalSubordinateClausesInTree([mainNode], clauses, tokens, byHead, byId, text, visited, nodesByClauseId)

  // Prototype 2.6G2.6B item 1/2 -- single-owner enforcement: a `parataxis`/coordinate-conj
  // clause candidate discovered below (or a subordinate/deep-nesting one) may ALREADY be
  // owned by a structural container built earlier in the SAME pass -- specifically, an
  // 'enumeration' node's own surface-marker recovery (`recoverSurfaceEnumeration`) grounds
  // an item's span from raw SOURCE TEXT ("(1) ... (2) ..."), entirely independent of, and
  // unaware of, this module's own separate ClauseFrame-driven paratactic/subordinate
  // discovery -- so the exact same clause (e.g. "the adjacency matrix is normalized...")
  // could otherwise be built TWICE: once flattened into an enumeration item's own text, and
  // again as a full top-level paratactic clause tree, with neither side aware of the other.
  // `mainNode` (built just above) is the ONLY place an enumeration can appear at this point
  // in the build, so collecting its own already-built enumeration spans here and checking
  // every further clause CANDIDATE's own head-token position against them is a general,
  // source-span-containment-based ownership check -- never text/case-ID-specific, and never
  // touching ClauseFrame/authority: a clause whose head falls inside an already-built
  // enumeration item is simply not re-added as a SEPARATE top-level sibling; its own content
  // remains fully available through the enumeration item that already owns it.
  const enumerationOwnedSpans: Span[] = []
  {
    const stack: StructureTreeNode[] = [mainNode]
    while (stack.length > 0) {
      const current = stack.pop()!
      if (current.role === 'enumeration') enumerationOwnedSpans.push({ text: current.text, start: current.start, end: current.end })
      stack.push(...current.children)
    }
  }
  const isOwnedByExistingEnumeration = (clause: ClauseFrame): boolean => {
    const headToken = byId.get(clause.headTokenId)
    if (!headToken) return false
    return isWithinAny({ text: headToken.text, start: headToken.start, end: headToken.end }, enumerationOwnedSpans)
  }

  // Sentence-level subordinate clauses: a clause whose relation is 'subordinate' and whose
  // parentClauseId anchors directly to the main clause is a top-level sibling, not nested
  // inside any constituent -- placed before the main clause node when its own span precedes
  // the subject (the common preposed "Because/Although/When ..." shape), after otherwise.
  // Each one recursively carries its OWN further-nested subordinate descendants via
  // buildClauseSubtree (item 3), so a subordinate-of-subordinate stays nested at its true
  // depth instead of also being promoted to this same top-level array.
  // Relative/reduced-relative/other(acl/ccomp/csubj) clauses are intentionally NOT surfaced
  // here: they are NP-internal (or PP-internal) postmodifiers or clausal O/subject slots,
  // already represented inside their antecedent constituent's own children by
  // buildDecomposedConstituentNode's own recursion, or inside their governing predicate's
  // own O slot. Opening modifiers pulled out of the main and subordinate predicates' own
  // oblique children join this same before/after placement -- the same positional rule that
  // already separates preposed subordinate clauses from the main clause. Prototype
  // 2.6G2.5B item B8: a subordinate clause's OWN opening modifiers stay scoped to that
  // clause (merged into its own children inside buildClauseSubtree), never hoisted here.
  const topLevelCandidates: StructureTreeNode[] = [...mainOpeningModifiers]
  for (const clause of clauses) {
    if (clause.relation !== 'subordinate') continue
    if (clause.parentClauseId !== mainClause.clauseId) continue
    if (isOwnedByExistingEnumeration(clause)) {
      visited.add(clause.clauseId) // single-owner: already shown inside its enumeration item
      continue
    }
    // Prototype 2.6G2.6C3 Part B item 11-17 -- COORDINATED_PREDICATE_SHARED_TRAILING_MODIFIER.
    // When the main clause has 2+ coordinated predicates (predicateHeadIds.length > 1) and
    // this subordinate clause's own raw dependency parent (headToken.head, the frozen,
    // unmodified Stanza field ClauseFrame itself never reads for parentClauseId resolution --
    // this reads it, never touches ClauseFrame) is exactly one of those predicate heads,
    // placement follows the CASE A/B/C policy instead of unconditionally falling through to
    // the flat top-level-sibling path below:
    //  - CASE A: attaches to a NON-ANCHOR coordinated predicate (predicateHeadIds[1+]) --
    //    reliable, specific structural evidence (UD would not have anchored it to a
    //    NON-head conjunct unless deliberately marking that one) -- nested under that exact
    //    predicate's own node (already the existing/correct behavior for a plain `obl`,
    //    e.g. "designed and applied for Z"; this branch generalizes it to `advcl`/subordinate
    //    clauses attaching the same way).
    //  - CASE B: attaches to the ANCHOR predicate (predicateHeadIds[0]) -- structurally
    //    ambiguous between "modifies predicate 1 only" and "modifies the whole coordinated-
    //    predicate construction" (live-diagnosed: "collected and analyzed using X" -- "using"
    //    raw-attaches to "collected", predicateHeadIds[0], yet plausibly describes both).
    //    Conservative GROUP-SCOPE placement: nested as an additional child of the SAME
    //    container that already holds every coordinated predicate as a sibling (`mainNode`),
    //    preserving source reading order via the existing `byStart` sort -- never asserting
    //    it belongs to predicate 1 specifically, never claiming semantic certainty that it
    //    modifies every predicate equally (section 14).
    //  - CASE C (predicateHeadIds.length === 1): this whole block never fires; falls through
    //    to the ordinary, unchanged top-level-sibling path.
    //
    // Restricted to SUBJECTLESS subordinate clauses (no nsubj/csubj of its own) -- a genuine
    // independent finite clause with its own subject (e.g. "if conditions allow", already an
    // accepted precedent from an earlier phase: a full conditional proposition, self-
    // sufficient regardless of which specific coordinated predicate it happens to raw-attach
    // to) stays exactly where it already correctly renders today, a clearly-delineated
    // top-level sibling with its own marker -- this policy targets only DEPENDENT modifiers
    // (bare gerund/participial "using X"/"based on Y"/"applied for Z"-shaped clauses) that
    // have no independent proposition of their own and therefore genuinely need a host.
    const clauseHeadToken = byId.get(clause.headTokenId)
    const isSubjectless = clauseHeadToken ? !(byHead.get(clauseHeadToken.id) ?? []).some((c) => c.deprel === 'nsubj' || c.deprel === 'csubj') : false
    if (isSubjectless && clauseHeadToken && mainClause.predicateHeadIds.length > 1) {
      const attachTarget = clauseHeadToken.head
      if (mainClause.predicateHeadIds.includes(attachTarget)) {
        // Prototype 2.6G2.6C3 Part B: built as a neutral 'modifier' node via the SAME
        // governing-predicate pattern `structureEnumerationItem` already established for a
        // subjectless subordinate clause (see that function's own `governingPredicateNode`
        // handling) -- deliberately NOT `buildClauseSubtree` (which would return a
        // role:'predicate' node). `groupingKey` in coordinationGroupPresentation.ts treats
        // 'predicate' and 'coordinatedPredicate' as the SAME "predicateFamily" run for
        // sibling-level coordination-group detection; a role:'predicate' node injected here
        // (which has no `.connector` of its own) would join that SAME run as mainNode's
        // OWN "were collected"/"analyzed" coordinatedPredicate siblings and fail
        // `buildGroupFromConnectors`' "every non-first member has a connector" check for the
        // WHOLE run -- silently dropping the "and" connector badge that must keep rendering
        // between the genuinely coordinated predicates (caught live while verifying this
        // exact fix). 'modifier' shares no groupingKey with 'predicate'/'coordinatedPredicate'
        // and cannot cause this collision.
        const siblingBoundaryIds = new Set<number>(mainClause.predicateHeadIds)
        const modifierNode = buildDecomposedConstituentNode('modifier', clauseHeadToken, byHead, tokens, siblingBoundaryIds, text)
        visited.add(clause.clauseId)
        if (attachTarget !== mainClause.predicateHeadIds[0]) {
          const targetToken = byId.get(attachTarget)!
          const targetPredicateNode = findPredicateNodeContaining(mainNode.children, targetToken.start)
          if (targetPredicateNode) {
            targetPredicateNode.children = byStart([...targetPredicateNode.children, modifierNode])
            continue
          }
        }
        mainNode.children = byStart([...mainNode.children, modifierNode])
        continue
      }
    }
    const subNode = buildClauseSubtree(clause, clauses, text, tokens, byHead, byId, visited, nodesByClauseId)
    if (subNode) topLevelCandidates.push(subNode)
  }

  // Paratactic/coordinate sibling clauses (item 4): semicolon-joined independent clauses,
  // anchored at the main clause's own head -- flat top-level siblings ("render as
  // coordinated/paratactic sibling clause"), each recursively carrying its own further
  // subordinate/paratactic descendants via buildClauseSubtree.
  for (const paratactic of collectAllParataticClauses(mainClause.headTokenId, clauses, byHead, byId, text)) {
    if (isOwnedByExistingEnumeration(paratactic)) {
      visited.add(paratactic.clauseId) // single-owner: already shown inside its enumeration item
      continue
    }
    const paraNode = buildClauseSubtree(paratactic, clauses, text, tokens, byHead, byId, visited, nodesByClauseId)
    if (paraNode) topLevelCandidates.push(paraNode)
  }

  // Deep-nesting fallback (item 3): any 'subordinate' clause not yet reached above (its own
  // official parentClauseId resolved to null or to a clause this build never visited, per
  // anchorClauseHead's conservative conj-only walk) is placed via a best-effort raw head-
  // chain walk instead of being silently dropped -- nested under the nearest already-known
  // clause it can be traced back to (looked up by clauseId in nodesByClauseId, never a
  // fragile span search), or as a last-resort top-level sibling if none is found. Iterates
  // to a fixed point since attaching one orphan can make it a valid anchor for another (a
  // genuine multi-level chain of otherwise-unreachable clauses).
  let progress = true
  while (progress) {
    progress = false
    const knownHeadIds = new Set(visited)
    for (const clause of clauses) {
      if (clause.relation !== 'subordinate') continue
      if (visited.has(clause.clauseId)) continue
      if (isOwnedByExistingEnumeration(clause)) {
        visited.add(clause.clauseId) // single-owner: already shown inside its enumeration item
        progress = true
        continue
      }
      const headToken = byId.get(clause.headTokenId)!
      const ancestorId = nearestKnownClauseAncestor(headToken, byId, knownHeadIds)
      if (ancestorId === null) continue
      const node = buildClauseSubtree(clause, clauses, text, tokens, byHead, byId, visited, nodesByClauseId)
      if (!node) continue
      progress = true
      if (ancestorId === mainClause.clauseId) {
        topLevelCandidates.push(node)
      } else {
        const ancestorNode = nodesByClauseId.get(ancestorId)
        if (ancestorNode) ancestorNode.children = byStart([...ancestorNode.children, node])
        else topLevelCandidates.push(node) // ancestor not actually built (shouldn't happen) -- never drop the clause
      }
    }
  }

  const before = topLevelCandidates.filter((n) => n.end <= mainNode.start)
  const after = topLevelCandidates.filter((n) => n.end > mainNode.start)

  return [...byStart(before), mainNode, ...byStart(after)]
}

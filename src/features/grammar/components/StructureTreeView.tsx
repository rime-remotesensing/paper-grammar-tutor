import { Fragment } from 'react'
import { layoutSiblingsWithCoordinationGroups } from '../domain/coordinationGroupPresentation'
import { parseSimpleCoordinationList } from '../domain/coordinationListParser'
import { deriveClauseDisplayLabel } from '../domain/clauseDisplayLabel'
import type { StructureDisplayRole, StructureTreeNode } from '../domain/structureTree'
import { CoordinationGroupView } from './CoordinationGroupView'
import { structureTreeNodeKey } from '../domain/treeReadingMatching'
import { deriveStructureNodePresentation } from '../domain/structureNodePresentation'

const STRUCTURE_NODE_ROLE_LABEL: Record<StructureDisplayRole, string> = {
  subject: '主語',
  predicate: '述語',
  coordinatedPredicate: '並列述語',
  openingModifier: '前置き',
  supplement: '補足',
  relativeClause: '関係節',
  postmodifier: '後置修飾',
  indirectObject: '間接目的語',
  object: '目的語',
  complement: '補語',
  condition: '条件',
  range: '範囲',
  modifier: '修飾',
  clause: '節',
  other: '他',
  enumeration: '列挙',
  expletive: '形式要素',
  // Prototype 2.6G2.6C item B/6/7: a coordination member of a canonical slot -- never the
  // slot's own grammatical role a second time (see 'coordinationMember' in structureTree.ts).
  coordinationMember: '構成要素',
  // Prototype 2.6G2.6C4.2B: a member of an explicit colon/semicolon-introduced enumeration
  // list (see 'enumerationMember' in structureTree.ts).
  enumerationMember: '列挙項目',
}

/** Prototype 2.3O item 23/57: no relative-word FUNCTION label (SUBJECT/OBJECT/POSSESSIVE)
 * anywhere in this file — 2.3N measured "that" function classification unreliable (0/20 in
 * two separate controls), and the production schema (focusedRelativeLink.schema.ts) never
 * carries that field at all. Only antecedent<->relativeWord linkage is shown. */

/** Prototype 2.3O item 20-22: when a sentence has more than one relation, each
 * antecedent<->relativeWord pair gets a small superscript index (¹/²/...) alongside the
 * existing single accent color, so relation pairs stay distinguishable without resorting to
 * multiple new colors ("派手なrainbow UIは禁止" — item 21) and without relying on color
 * alone (item 22 accessibility). A single-relation sentence never shows an index — the
 * plain underline/marker from 2.3M is enough on its own. */
function relationMarkerIndex(node: StructureTreeNode, showRelationIndex: boolean) {
  if (!showRelationIndex || node.relationIndex === undefined) return null
  return <sup className="relation-marker-index">{node.relationIndex + 1}</sup>
}

/** A node's own displayed text — split into a visual coordination list (item 8/9/10) when
 * its exact text matches the conservative "A, B and C" / "A, B, and C" shape, otherwise
 * shown as a single unbroken line exactly as grounded (item 22: raw text never altered,
 * only re-segmented for display when the parser is confident). The leading preposition
 * (e.g. "of"), if any, stays OUTSIDE the coordination box (item 10); the connector is the
 * box's own corner badge, never an inline token before the last item (item 9).
 *
 * Prototype 2.3M: a node whose ROLE is 'relativeClause' gets its own leading word (the
 * relative pronoun — "that"/"which"/"who"/...) wrapped in the same accent marker class as
 * its antecedent (see `isAntecedent`) — item 9: never paint the whole clause a loud color,
 * only the pronoun itself, so the antecedent<->pronoun relation reads as one visual pair
 * without a distracting block of color across the whole relative clause. */
function NodeText({
  node,
  displayText,
  isAntecedent = false,
  showRelationIndex = false,
  disableTextCoordinationInference = false,
}: {
  node: StructureTreeNode
  displayText: string
  isAntecedent?: boolean
  showRelationIndex?: boolean
  /** Prototype 2.6G2.2 item 3: when true (Stanza-authoritative trees), this node's own
   * dependency-grounded structure is already final -- `parseSimpleCoordinationList`'s
   * text-only "does this look like A, B and C" guess must never override it (it previously
   * misread flat PP text like "by a mixture of geological conditions and environmental
   * factors" as a coordination list split at the wrong boundary, even though the underlying
   * node was a single correct span with no such split anywhere in its real children). The
   * legacy Hybrid-tree path leaves this false and keeps its original heuristic behavior
   * unchanged, since that path can genuinely need the text-level split (see the "of X, Y and
   * Z" case in buildHybridStructureTree's own docs). */
  disableTextCoordinationInference?: boolean
}) {
  if (node.role === 'relativeClause') {
    // Prototype 2.6G2.6C2 item 12/13: uses `displayText` (the presentation-trimmed span,
    // already computed by the caller from `node.presentationSpan ?? node.text`), never the
    // node's own raw `.text` -- a relative clause with a further-nested relativeClause CHILD
    // (e.g. "which is a highly complex process" wrapping "that is executed...") has a
    // presentationSpan that stops BEFORE the nested clause's own span specifically so the
    // nested clause's text renders exactly once, as its own separate row below; splitting the
    // untrimmed `.text` here re-duplicated it inline on top of that (fixed as part of this
    // phase's antecedent work, since the fix below needs offsets INTO this exact same text).
    const [pronoun, ...rest] = displayText.split(/(\s+)/)
    const displayStart = (node.presentationSpan ?? node).start
    // Prototype 2.6G2.6C2 item 7/8/9: a NESTED relative clause's own antecedent NP (e.g. "a
    // highly complex process", the antecedent of the INNER "that") frequently has no separate
    // visible Tree row of its own -- it is grounded PRESENTATION METADATA only
    // (`antecedentSpan`, see stanzaStructureTree.ts's `groundRelativeClauseAntecedent`),
    // pointing at a source span that sits INSIDE this OUTER relative clause's own displayed
    // text. Rather than fabricate a new row solely for styling (explicitly forbidden), that
    // substring is underlined in place, using the SAME `.relative-antecedent` class an
    // ordinary whole-node antecedent gets -- one consistent visual system, no new colors.
    const nestedAntecedent = node.children
      .map((c) => c.antecedentSpan)
      .find((span): span is NonNullable<typeof span> => Boolean(span) && span!.start >= displayStart && span!.end <= displayStart + displayText.length)
    const relStart = nestedAntecedent ? nestedAntecedent.start - displayStart : -1
    const relEnd = nestedAntecedent ? nestedAntecedent.end - displayStart : -1
    if (nestedAntecedent && relStart >= pronoun.length && relEnd <= displayText.length && relStart < relEnd) {
      return (
        <span className="structure-tree-text">
          <span className="relative-marker">
            {pronoun}
            {relationMarkerIndex(node, showRelationIndex)}
          </span>
          {displayText.slice(pronoun.length, relStart)}
          <span className="relative-antecedent">{displayText.slice(relStart, relEnd)}</span>
          {displayText.slice(relEnd)}
        </span>
      )
    }
    return (
      <span className="structure-tree-text">
        <span className="relative-marker">
          {pronoun}
          {relationMarkerIndex(node, showRelationIndex)}
        </span>
        {rest.join('')}
      </span>
    )
  }

  // Prototype 2.5X item 11/12: for a "clause" node whose grounded children already
  // decompose its own text (e.g. "where Ln is..., a and b are..." with those exact
  // propositions rendered as children right below), show only the structural prefix
  // ("where") instead of the full text again — the full text remains the node's own
  // authoritative `.text` for grounding/provenance, this only changes what's displayed.
  const derivedText = node.role === 'clause' ? deriveClauseDisplayLabel(node) : displayText

  const parsed = disableTextCoordinationInference ? null : parseSimpleCoordinationList(derivedText)
  if (!parsed) {
    return (
      <span className={isAntecedent ? 'structure-tree-text relative-antecedent' : 'structure-tree-text'}>
        {derivedText}
        {isAntecedent && relationMarkerIndex(node, showRelationIndex)}
      </span>
    )
  }
  return (
    <>
      {parsed.prefix && <span className="structure-tree-text">{parsed.prefix}</span>}
      <CoordinationGroupView connector={parsed.conjunction}>
        <ul className="coordination-group-members">
          {parsed.items.map((item, i) => (
            <li key={i}>
              <span className="structure-tree-text">{item}</span>
            </li>
          ))}
        </ul>
      </CoordinationGroupView>
    </>
  )
}

/**
 * Compact, nested-list rendering of the structure tree — plain semantic DOM (ul/li), not
 * canvas/an image, so the hierarchy stays selectable and readable with CSS off. Role labels
 * are visually secondary to the phrase text. The tree comes from either buildCoreOnlyTree
 * (structure call not yet successful) or buildHybridStructureTree (the deterministic
 * hybrid merger's result) — this view handles either shape unchanged.
 *
 * Prototype 2.3D/2.3E: siblings the hybrid merger already validated as coordinated (main +
 * coordinated predicates sharing a subject) or that share a role and are joined by an
 * explicit connector in the source text (e.g. two "condition" dependents) are wrapped in a
 * shared box instead of a flat list — PURELY a rendering decision
 * (layoutSiblingsWithCoordinationGroups), no new field on StructureTreeNode itself. Each
 * group's members still render as ordinary tree rows inside the box (item 16: one group,
 * not N separate cards) — nested indentation/border-left guides remain visible at every
 * depth (item 18).
 *
 * Prototype 2.5ZA (item 9/11/17/18): for N members ("A, B, and C") the connector is NOT a
 * single badge implying the whole group is "labelled and" — it renders as its own small row
 * immediately before the specific member it precedes (`group.boundaryConnectors`, index 0
 * always null), matching where the source coordinator actually sits (the B→C boundary, not
 * the group as a whole). A 2-member group ("A and B") uses the exact same mechanism —
 * boundaryConnectors is [null, "and"] — so there is only one rendering path for every group
 * size, never a special-cased 3+ branch. This box intentionally does NOT reuse
 * CoordinationGroupView (that component's single corner-badge design remains exactly as-is
 * for NodeText's own separate single-node-text coordination list below, e.g. "of X, Y and
 * Z" inside one leaf's own text — untouched by this prototype).
 *
 * `multipleRelations` (Prototype 2.3O item 20, default false) is threaded unchanged through
 * every recursive call — it never varies within one tree render, only whether the caller's
 * Focused Relative-Link result had more than one relation.
 */
export function StructureTreeView({
  nodes,
  sentence,
  multipleRelations = false,
  structuredSyntax = false,
  activeNodeKey = null,
  pinnedNodeKey = null,
  onPreview,
  onLeave,
  onTogglePin,
  onClearPin,
}: {
  nodes: StructureTreeNode[]
  sentence: string
  multipleRelations?: boolean
  /** Prototype 2.6G2.2 item 3 (default false, legacy behavior unchanged): true when `nodes`
   * came from the Stanza-authoritative Tree builder. Disables `parseSimpleCoordinationList`'s
   * text-only coordination guess for every node in this tree, since Stanza's own dependency
   * structure is already the final authority on what is/isn't coordinated -- see NodeText. */
  structuredSyntax?: boolean
  activeNodeKey?: string | null
  pinnedNodeKey?: string | null
  onPreview?: (node: StructureTreeNode) => void
  onLeave?: (node: StructureTreeNode) => void
  onTogglePin?: (node: StructureTreeNode) => void
  onClearPin?: () => void
}) {
  // Prototype 2.6G2.3 item 1: an 'enumeration' node is a purely STRUCTURAL container (see
  // stanzaStructureTree.ts) -- its own authority text is the full concatenated list, which
  // must never render as an extra row repeating every member's text. Splicing its children
  // into this same sibling position renders every list item exactly once, in place, while
  // the underlying StructureTreeNode graph (and every existing coverage/regression test
  // reading it) keeps the real 'enumeration' node and its grouping completely unchanged --
  // only the VIEW flattens it. Legacy Hybrid-tree output never produces this role, so this
  // is a no-op there.
  const visibleNodes = nodes.flatMap((n) => (n.role === 'enumeration' ? n.children : [n]))
  if (visibleNodes.length === 0) return null
  // Prototype 2.6G2.6C (Generalized Tree Presentation Completion) Problem D/section 15 -- a
  // nonrestrictive relative clause promoted to COORDINATION SCOPE (stanzaStructureTree.ts's
  // own promotion logic) sits as a SIBLING of the coordination's own 'coordinationMember'
  // nodes at exactly this level, never nested inside any one of them (that is precisely what
  // distinguishes "whole coordination is the antecedent" from "only this one member is" --
  // see that promotion code's own doc comment). The coordination CONTAINER's own row is
  // presentation-empty (children fully represent it, per B4 discipline) so it never has
  // visible text to underline; the antecedent affordance is therefore given to each VISIBLE
  // coordination-member sibling instead -- together they visually read as "this is the whole
  // antecedent". A relative clause left LOCAL to one member (the restrictive/non-promoted
  // case) is nested one level deeper inside that member's own children, never a sibling here,
  // so this never fires for that case -- no fabricated binding, purely structural placement.
  const siblingHasPromotedRelativeClause = visibleNodes.some((n) => n.role === 'relativeClause')
  const items = layoutSiblingsWithCoordinationGroups(sentence, visibleNodes)
  return (
    <ul className="structure-tree">
      {items.map((item, i) =>
        item.kind === 'node' ? (
          <li key={i}>
            <TreeNodeButton
              node={item.node}
              active={activeNodeKey === structureTreeNodeKey(item.node)}
              pinned={pinnedNodeKey === structureTreeNodeKey(item.node)}
              multipleRelations={multipleRelations}
              structuredSyntax={structuredSyntax}
              forceAntecedent={item.node.role === 'coordinationMember' && siblingHasPromotedRelativeClause}
              onPreview={onPreview}
              onLeave={onLeave}
              onTogglePin={onTogglePin}
              onClearPin={onClearPin}
            />
            <StructureTreeView nodes={item.node.children} sentence={sentence} multipleRelations={multipleRelations} structuredSyntax={structuredSyntax} activeNodeKey={activeNodeKey} pinnedNodeKey={pinnedNodeKey} onPreview={onPreview} onLeave={onLeave} onTogglePin={onTogglePin} onClearPin={onClearPin} />
          </li>
        ) : (
          <li key={i} className="coordination-group-item">
            <div className="coordination-group" aria-label="並列関係">
              <ul className="coordination-group-members">
                {item.group.members.map((member, mi) => (
                  <Fragment key={mi}>
                    {/* Prototype 2.6G2.3 item 2/4: the connector badge row is the SOLE
                        renderer of a coordination connector -- a node's own button never
                        shows one inline any more, so this is never a duplicate. */}
                    {item.group.boundaryConnectors[mi] && <li className="coordination-group-connector">{item.group.boundaryConnectors[mi]}</li>}
                    <li>
                      <TreeNodeButton
                        node={member}
                        active={activeNodeKey === structureTreeNodeKey(member)}
                        pinned={pinnedNodeKey === structureTreeNodeKey(member)}
                        multipleRelations={multipleRelations}
                        structuredSyntax={structuredSyntax}
                        forceAntecedent={member.role === 'coordinationMember' && siblingHasPromotedRelativeClause}
                        onPreview={onPreview}
                        onLeave={onLeave}
                        onTogglePin={onTogglePin}
                        onClearPin={onClearPin}
                      />
                      <StructureTreeView nodes={member.children} sentence={sentence} multipleRelations={multipleRelations} structuredSyntax={structuredSyntax} activeNodeKey={activeNodeKey} pinnedNodeKey={pinnedNodeKey} onPreview={onPreview} onLeave={onLeave} onTogglePin={onTogglePin} onClearPin={onClearPin} />
                    </li>
                  </Fragment>
                ))}
              </ul>
            </div>
          </li>
        ),
      )}
    </ul>
  )
}

function TreeNodeButton({
  node,
  active,
  pinned,
  multipleRelations,
  structuredSyntax,
  forceAntecedent = false,
  onPreview,
  onLeave,
  onTogglePin,
  onClearPin,
}: {
  node: StructureTreeNode
  active: boolean
  pinned: boolean
  multipleRelations: boolean
  structuredSyntax: boolean
  /** Prototype 2.6G2.6C Problem D/section 15: true when this node is one visible member of a
   * coordination whose nonrestrictive relative clause was promoted to coordination scope (a
   * sibling of this node, not nested inside it) -- see the caller's own
   * `siblingHasPromotedRelativeClause` doc comment. Structurally derived, never guessed. */
  forceAntecedent?: boolean
  onPreview?: (node: StructureTreeNode) => void
  onLeave?: (node: StructureTreeNode) => void
  onTogglePin?: (node: StructureTreeNode) => void
  onClearPin?: () => void
}) {
  const interactive = Boolean(onPreview || onTogglePin)
  const presentation = deriveStructureNodePresentation(node)
  // Prototype 2.6G2.5B3 items 2/4/6: a marker wrapper's own `.text` now IS the marker word
  // (see stanzaStructureTree.ts's wrapWithMarker) -- showing the separate marker badge
  // AND NodeText would duplicate it ("if if"). The badge only earns its own row when it
  // introduces content distinct from the node's own displayed text (kept for forward
  // compatibility / any future non-wrapper marker use; never fires for the current
  // wrapper-only marker design, since a wrapper's text and its marker are always equal).
  const showMarkerBadge = Boolean(node.marker) && node.marker!.text !== node.text
  // Prototype 2.6G2.6C6 -- a coordinated predicate that grammatically inherits the main
  // predicate's own auxiliary/passive-auxiliary scope (e.g. "were" for "converted" in "were
  // collected and converted...") shows that REAL, already-grounded source span as a small
  // badge before its own text -- never fused into `.text` (the Span contract stays intact;
  // see `sharedAuxiliarySpan`'s own doc comment in structureTree.ts), never a fabricated
  // "were converted" string. Distinguishing CSS class from the marker badge above, since the
  // two concepts (clause-introducing subordinator vs. inherited auxiliary) are never the same
  // node in practice but are kept visually distinct on principle.
  const showSharedAuxiliaryBadge = Boolean(node.sharedAuxiliarySpan)
  // Item 6/9: a canonical-slot node fully decomposed into coordination-member children (or
  // a subjectless multi-predicate clause container) carries deliberately empty presentation
  // text -- rendering an empty lexical row would be a bare, meaningless label; the real
  // content is entirely in its children, rendered immediately below by the recursive call.
  const showNodeText = presentation.text.trim().length > 0
  return (
    <button
      type="button"
      className={`structure-tree-node${active ? ' is-active' : ''}${pinned ? ' is-pinned' : ''}`}
      aria-pressed={pinned}
      disabled={!interactive}
      onMouseEnter={() => onPreview?.(node)}
      onMouseLeave={() => onLeave?.(node)}
      onFocus={() => onPreview?.(node)}
      onBlur={() => onLeave?.(node)}
      onClick={() => onTogglePin?.(node)}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault()
          onClearPin?.()
        }
      }}
      aria-label={`${showMarkerBadge ? node.marker!.text + ' ' : ''}${node.connector ? node.connector.text + ' ' : ''}${showSharedAuxiliaryBadge ? node.sharedAuxiliarySpan!.text + ' ' : ''}${presentation.text}（${STRUCTURE_NODE_ROLE_LABEL[node.role]}）${pinned ? '、選択固定中' : ''}`}
    >
      {/* Prototype 2.6G2.3 item 2/4: connector rendering moved OUT of the node's own button
          entirely -- the sibling-level connector badge row (StructureTreeView, driven by
          buildGroupFromConnectors) is now the single canonical renderer, so a coordinated
          member's own button never shows its connector inline. aria-label above still
          mentions it for a11y context without a second VISIBLE rendering. */}
      {/* Prototype 2.6G2.5B / 2.6G2.5B3: a clause-introducing marker (if/because/.../
          infinitival "to") is rendered inline here ONLY when distinct from the node's own
          text (see showMarkerBadge above) -- the current marker-wrapper design (item 2/5)
          always makes them equal, so this never double-renders "if if". */}
      {showMarkerBadge && <span className="structure-tree-marker">{node.marker!.text}</span>}
      {showSharedAuxiliaryBadge && <span className="structure-tree-shared-auxiliary">{node.sharedAuxiliarySpan!.text}</span>}
      {showNodeText && (
        <NodeText
          node={node}
          displayText={presentation.text}
          isAntecedent={
            forceAntecedent ||
            node.relationIndex !== undefined ||
            // Prototype 2.6G2.6C3 Part A item 6: a directly-nested relativeClause child only
            // marks THIS node as the antecedent when its own `antecedentSpan` is actually
            // defined and covers this node's own span -- stanzaStructureTree.ts now clears
            // `antecedentSpan` to `undefined` for the specific ambiguous case where whole-
            // coordination promotion was rejected by negative agreement evidence but no
            // reliable structural evidence identifies which member (if any) is the true
            // antecedent (section 6: "no underline > wrong underline"). Blindly checking only
            // "does a relativeClause child exist" (the pre-2.6G2.6C3 behavior) would still
            // underline this member purely from its raw UD attachment position, exactly the
            // confidently-wrong binding this phase exists to prevent.
            node.children.some((c) => {
              if (c.role !== 'relativeClause' || !c.antecedentSpan) return false
              // Compares against this node's own DISPLAYED span (presentationSpan when set,
              // e.g. "The samples" trimmed of its own restrictive relative clause's text --
              // never the raw authority span, which for a restrictive relative still includes
              // the clause's own text and would never match the trimmed antecedent grounding).
              const nodeSpan = node.presentationSpan ?? { start: node.start, end: node.end }
              return nodeSpan.start >= c.antecedentSpan.start && nodeSpan.end <= c.antecedentSpan.end
            })
          }
          showRelationIndex={multipleRelations}
          disableTextCoordinationInference={structuredSyntax}
        />
      )}
      <span className="structure-tree-role">{STRUCTURE_NODE_ROLE_LABEL[node.role]}</span>
    </button>
  )
}

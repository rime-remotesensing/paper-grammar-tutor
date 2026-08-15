import { layoutSiblingsWithCoordinationGroups } from '../domain/coordinationGroupPresentation'
import { parseSimpleCoordinationList } from '../domain/coordinationListParser'
import type { StructureDisplayRole, StructureTreeNode } from '../domain/structureTree'
import { CoordinationGroupView } from './CoordinationGroupView'

const STRUCTURE_NODE_ROLE_LABEL: Record<StructureDisplayRole, string> = {
  subject: '主語',
  predicate: '述語',
  coordinatedPredicate: '並列述語',
  openingModifier: '前置き',
  supplement: '補足',
  relativeClause: '関係節',
  indirectObject: '間接目的語',
  object: '目的語',
  complement: '補語',
  condition: '条件',
  range: '範囲',
  modifier: '修飾',
  clause: '節',
  other: '他',
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
  isAntecedent = false,
  showRelationIndex = false,
}: {
  node: StructureTreeNode
  isAntecedent?: boolean
  showRelationIndex?: boolean
}) {
  if (node.role === 'relativeClause') {
    const [pronoun, ...rest] = node.text.split(/(\s+)/)
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

  const parsed = parseSimpleCoordinationList(node.text)
  if (!parsed) {
    return (
      <span className={isAntecedent ? 'structure-tree-text relative-antecedent' : 'structure-tree-text'}>
        {node.text}
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
 * CoordinationGroupView box instead of a flat list — PURELY a rendering decision
 * (layoutSiblingsWithCoordinationGroups), no new field on StructureTreeNode itself. Each
 * group's members still render as ordinary tree rows inside the box (item 16: one group,
 * not N separate cards) — nested indentation/border-left guides remain visible at every
 * depth (item 18).
 *
 * `multipleRelations` (Prototype 2.3O item 20, default false) is threaded unchanged through
 * every recursive call — it never varies within one tree render, only whether the caller's
 * Focused Relative-Link result had more than one relation.
 */
export function StructureTreeView({
  nodes,
  sentence,
  multipleRelations = false,
}: {
  nodes: StructureTreeNode[]
  sentence: string
  multipleRelations?: boolean
}) {
  if (nodes.length === 0) return null
  const items = layoutSiblingsWithCoordinationGroups(sentence, nodes)
  return (
    <ul className="structure-tree">
      {items.map((item, i) =>
        item.kind === 'node' ? (
          <li key={i}>
            <NodeText
              node={item.node}
              isAntecedent={item.node.relationIndex !== undefined || item.node.children.some((c) => c.role === 'relativeClause')}
              showRelationIndex={multipleRelations}
            />
            <span className="structure-tree-role">{STRUCTURE_NODE_ROLE_LABEL[item.node.role]}</span>
            <StructureTreeView nodes={item.node.children} sentence={sentence} multipleRelations={multipleRelations} />
          </li>
        ) : (
          <li key={i} className="coordination-group-item">
            <CoordinationGroupView connector={item.group.connectorText}>
              <ul className="coordination-group-members">
                {item.group.members.map((member, mi) => (
                  <li key={mi}>
                    <NodeText
                      node={member}
                      isAntecedent={member.relationIndex !== undefined || member.children.some((c) => c.role === 'relativeClause')}
                      showRelationIndex={multipleRelations}
                    />
                    <span className="structure-tree-role">{STRUCTURE_NODE_ROLE_LABEL[member.role]}</span>
                    <StructureTreeView nodes={member.children} sentence={sentence} multipleRelations={multipleRelations} />
                  </li>
                ))}
              </ul>
            </CoordinationGroupView>
          </li>
        ),
      )}
    </ul>
  )
}

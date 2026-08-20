import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { DEVELOPMENT_CASES, LOCKED_HOLDOUT_CASES } from '../../benchmark/generalization/dataset.ts'
import { BLIND_HOLDOUT_V2 } from '../../benchmark/generalization/blindHoldoutV2.ts'
import type { StanzaToken } from '../../src/features/grammar/domain/stanzaSyntaxAuthority.ts'
import { buildStanzaHierarchicalTree } from '../../src/features/grammar/domain/stanzaStructureTree.ts'
import type { StructureTreeNode } from '../../src/features/grammar/domain/structureTree.ts'

/**
 * Prototype 2.6G2.6C (Generalized Tree Presentation Completion) section 24 -- two of the new
 * hard gates, run as INDEPENDENT corpus-wide audits over the full 96-sentence generalization
 * corpus (never reusing stanzaStructureTree.ts's own construction logic as the check):
 *
 * - CANONICAL_ROLE_LABEL_DUPLICATION = 0
 * - CROSS_TYPE_VISIBLE_OWNERSHIP_DUPLICATION = 0
 *
 * (LOW_VALUE_INTERNAL_COORDINATION_DUPLICATION, ENUMERATION_INTERNAL_OWNER_DUPLICATION, and
 * RELATIVE_INTERACTION_COVERAGE already have their own dedicated synthetic-fixture test files
 * from the prior phase; RELATIVE_ANTECEDENT_BINDING_CORRECTNESS has its own dedicated
 * rendered-component test file, stanzaStructureTreeAntecedentBinding.test.ts.)
 */

interface RawParsedCase {
  id: string
  text: string
  tokens: StanzaToken[]
}

function loadRaw(fileName: string): RawParsedCase[] {
  const filePath = path.join(process.cwd(), 'benchmark', 'results', 'generalization', fileName)
  const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8')) as { results: RawParsedCase[] }
  return parsed.results
}

const SPLITS: Array<{ name: string; cases: readonly { id: string; text: string }[]; rawFile: string }> = [
  { name: 'development', cases: DEVELOPMENT_CASES, rawFile: 'stanza-development.json' },
  { name: 'former holdout', cases: LOCKED_HOLDOUT_CASES, rawFile: 'stanza-holdout.json' },
  { name: 'blind holdout v2', cases: BLIND_HOLDOUT_V2, rawFile: 'stanza-blind-v2.json' },
]

const missingArtifact = SPLITS.some((split) => !fs.existsSync(path.join(process.cwd(), 'benchmark', 'results', 'generalization', split.rawFile)))

const CANONICAL_SLOT_ROLES = new Set(['subject', 'object', 'indirectObject', 'complement'])

interface Visited {
  node: StructureTreeNode
  parents: StructureTreeNode[]
}

function walk(nodes: StructureTreeNode[], parents: StructureTreeNode[], out: Visited[]): void {
  for (const node of nodes) {
    out.push({ node, parents })
    walk(node.children, [...parents, node], out)
  }
}

describe('Prototype 2.6G2.6C section 24 -- CANONICAL_ROLE_LABEL_DUPLICATION = 0 (96-sentence corpus)', () => {
  it.skipIf(missingArtifact)('no canonical-slot role (subject/object/indirectObject/complement) is repeated onto its own DIRECT presentation-decomposition child', () => {
    let total = 0
    let violations = 0
    const failures: string[] = []

    for (const split of SPLITS) {
      const raw = loadRaw(split.rawFile)
      for (const item of split.cases) {
        const parsed = raw.find((entry) => entry.id === item.id)
        if (!parsed) continue
        const tree = buildStanzaHierarchicalTree(item.text, parsed.tokens)
        const all: Visited[] = []
        walk(tree, [], all)
        total += all.length

        for (const { node } of all) {
          if (!CANONICAL_SLOT_ROLES.has(node.role)) continue
          // A canonical-slot node's own DIRECT children must never repeat the SAME canonical
          // role -- that would mean the presentation decomposition of ONE canonical slot
          // fabricated a second/third "subject"/"object"/etc. label for its own members
          // (section 6/29's exact complaint). Excluded: a genuinely distinct embedded/
          // coordinated-predicate clause's own subject, presented as a sibling of a
          // 'predicate'/'coordinatedPredicate' child at this SAME level (the established
          // per-conjunct-subject wrapping, e.g. "Rainfall intensified ... but the monitored
          // slopes remained stable" -- "the monitored slopes" is "remained"'s own genuine
          // subject, section 7's explicit "Case B is legitimate" carve-out) -- a same-role
          // COORDINATION-MEMBER duplication (the actual bug class) never has a predicate
          // sibling mixed into that same children array, since it is one NP's own internal
          // members, not a clause-level container holding multiple predicates.
          const hasPredicateSibling = node.children.some((c) => c.role === 'predicate' || c.role === 'coordinatedPredicate')
          if (hasPredicateSibling) continue
          const sameRoleChildren = node.children.filter((c) => c.role === node.role)
          if (sameRoleChildren.length > 0) {
            violations += 1
            failures.push(`${split.name}/${item.id}: canonical "${node.role}" node "${node.text}" has ${sameRoleChildren.length} direct child/children repeating role "${node.role}"`)
          }
        }
      }
    }

    if (failures.length > 0) console.error(`CANONICAL_ROLE_LABEL_DUPLICATION failures (${failures.length}):\n${failures.slice(0, 50).join('\n')}`)
    console.log(`CANONICAL_ROLE_LABEL_DUPLICATION audit: ${total} total nodes; violations: ${violations}`)
    expect(violations).toBe(0)
  })
})

/** The visible presentation span of a node -- undefined when the node renders no visible text
 * of its own (an empty presentationSpan, e.g. a coordination container or a structured
 * enumeration item/postmodifier whose children fully represent it -- StructureTreeView never
 * renders a row for it, so it can never visually overlap anything). */
function visibleSpan(node: StructureTreeNode): { start: number; end: number } | null {
  const span = node.presentationSpan ?? { text: node.text, start: node.start, end: node.end }
  if (span.text.trim().length === 0) return null
  return { start: span.start, end: span.end }
}

describe('Prototype 2.6G2.6C section 24 -- CROSS_TYPE_VISIBLE_OWNERSHIP_DUPLICATION = 0 (96-sentence corpus)', () => {
  it.skipIf(missingArtifact)('no two structurally-unrelated (non-ancestor/descendant) nodes render overlapping visible source text', () => {
    let total = 0
    let violations = 0
    const failures: string[] = []

    for (const split of SPLITS) {
      const raw = loadRaw(split.rawFile)
      for (const item of split.cases) {
        const parsed = raw.find((entry) => entry.id === item.id)
        if (!parsed) continue
        const tree = buildStanzaHierarchicalTree(item.text, parsed.tokens)
        const all: Visited[] = []
        walk(tree, [], all)

        const visible = all
          .map(({ node, parents }) => ({ node, parents, span: visibleSpan(node) }))
          .filter((v): v is { node: StructureTreeNode; parents: StructureTreeNode[]; span: { start: number; end: number } } => v.span !== null)
        total += visible.length

        for (let i = 0; i < visible.length; i++) {
          for (let j = i + 1; j < visible.length; j++) {
            const a = visible[i]!
            const b = visible[j]!
            const overlap = Math.max(a.span.start, b.span.start) < Math.min(a.span.end, b.span.end)
            if (!overlap) continue
            const aIsAncestorOfB = b.parents.includes(a.node)
            const bIsAncestorOfA = a.parents.includes(b.node)
            if (aIsAncestorOfB || bIsAncestorOfA) continue // ordinary parent/child nesting -- not a violation
            violations += 1
            failures.push(`${split.name}/${item.id}: unrelated nodes "${a.node.text}" (${a.node.role}) and "${b.node.text}" (${b.node.role}) render overlapping visible text`)
          }
        }
      }
    }

    if (failures.length > 0) console.error(`CROSS_TYPE_VISIBLE_OWNERSHIP_DUPLICATION failures (${failures.length}):\n${failures.slice(0, 50).join('\n')}`)
    console.log(`CROSS_TYPE_VISIBLE_OWNERSHIP_DUPLICATION audit: ${total} total visible nodes; violations: ${violations}`)
    expect(violations).toBe(0)
  })
})

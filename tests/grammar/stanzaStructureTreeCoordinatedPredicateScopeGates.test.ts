import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { DEVELOPMENT_CASES, LOCKED_HOLDOUT_CASES } from '../../benchmark/generalization/dataset.ts'
import { BLIND_HOLDOUT_V2 } from '../../benchmark/generalization/blindHoldoutV2.ts'
import { buildClauseFrames, childrenByHead, type StanzaToken } from '../../src/features/grammar/domain/stanzaSyntaxAuthority.ts'
import { buildStanzaHierarchicalTree } from '../../src/features/grammar/domain/stanzaStructureTree.ts'
import type { StructureTreeNode } from '../../src/features/grammar/domain/structureTree.ts'

/**
 * Prototype 2.6G2.6C3 (Conservative Relative Scope + Coordinated-Predicate Clause Scope
 * Presentation) section 18 -- two new hard gates, run as INDEPENDENT corpus-wide audits over
 * the full 96-sentence generalization corpus:
 *
 * - COORDINATED_PREDICATE_SUBORDINATE_ORPHAN = 0 -- a subordinate ClauseFrame owned by a
 *   coordinated-predicate main clause (subjectless, raw-attached to one of that clause's own
 *   predicateHeadIds) must never render as a detached sentence-level orphan.
 * - COORDINATED_PREDICATE_FALSE_SPECIFIC_SCOPE = 0 -- for the ambiguous (anchor-attached)
 *   case, the resulting node must never be forced under predicateHeadIds[0]'s own node
 *   specifically (that would silently assert a "modifies predicate 1 only" reading the raw
 *   structure does not support).
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

describe('Prototype 2.6G2.6C3 section 18 -- COORDINATED_PREDICATE_SUBORDINATE_ORPHAN = 0 (96-sentence corpus)', () => {
  it.skipIf(missingArtifact)('a subjectless subordinate clause anchored to a coordinated-predicate main clause is never a detached top-level sibling', () => {
    let candidates = 0
    let violations = 0
    const failures: string[] = []

    for (const split of SPLITS) {
      const raw = loadRaw(split.rawFile)
      for (const item of split.cases) {
        const parsed = raw.find((entry) => entry.id === item.id)
        if (!parsed) continue
        const tokens = parsed.tokens
        const byHead = childrenByHead(tokens)
        const byId = new Map(tokens.map((t) => [t.id, t]))
        const clauses = buildClauseFrames(item.text, tokens, byHead)
        const mainClause = clauses.find((c) => c.relation === 'main')
        if (!mainClause || mainClause.predicateHeadIds.length <= 1) continue

        const tree = buildStanzaHierarchicalTree(item.text, tokens)
        const all: Visited[] = []
        walk(tree, [], all)

        for (const clause of clauses) {
          if (clause.relation !== 'subordinate') continue
          if (clause.parentClauseId !== mainClause.clauseId) continue
          const headToken = byId.get(clause.headTokenId)
          if (!headToken) continue
          const hasOwnSubject = (byHead.get(headToken.id) ?? []).some((c) => c.deprel === 'nsubj' || c.deprel === 'csubj')
          if (hasOwnSubject) continue // genuine independent clause, unaffected by this policy
          if (!mainClause.predicateHeadIds.includes(headToken.head)) continue
          candidates += 1

          // "Orphan" = this clause's own head token is contained by a node that is itself a
          // TOP-LEVEL entry in `tree` (not nested inside the main subject/clause structure).
          const owner = all.find((v) => v.node.start <= headToken.start && v.node.end >= headToken.end && v.parents.length === 0)
          if (owner && tree.length > 1) {
            violations += 1
            failures.push(`${split.name}/${item.id}: subordinate clause headed by "${headToken.text}" renders as a detached top-level sibling`)
          }
        }
      }
    }

    if (failures.length > 0) console.error(`COORDINATED_PREDICATE_SUBORDINATE_ORPHAN failures (${failures.length}):\n${failures.join('\n')}`)
    console.log(`COORDINATED_PREDICATE_SUBORDINATE_ORPHAN audit: ${candidates} candidates; violations: ${violations}`)
    expect(violations).toBe(0)
  })
})

describe('Prototype 2.6G2.6C3 section 18 -- COORDINATED_PREDICATE_FALSE_SPECIFIC_SCOPE = 0 (96-sentence corpus)', () => {
  it.skipIf(missingArtifact)('an anchor-attached (ambiguous) group-scope modifier is never forced under predicateHeadIds[0]\'s own node specifically', () => {
    let candidates = 0
    let violations = 0
    const failures: string[] = []

    for (const split of SPLITS) {
      const raw = loadRaw(split.rawFile)
      for (const item of split.cases) {
        const parsed = raw.find((entry) => entry.id === item.id)
        if (!parsed) continue
        const tokens = parsed.tokens
        const byHead = childrenByHead(tokens)
        const byId = new Map(tokens.map((t) => [t.id, t]))
        const clauses = buildClauseFrames(item.text, tokens, byHead)
        const mainClause = clauses.find((c) => c.relation === 'main')
        if (!mainClause || mainClause.predicateHeadIds.length <= 1) continue
        const anchorId = mainClause.predicateHeadIds[0]!

        const tree = buildStanzaHierarchicalTree(item.text, tokens)
        const all: Visited[] = []
        walk(tree, [], all)

        for (const clause of clauses) {
          if (clause.relation !== 'subordinate') continue
          if (clause.parentClauseId !== mainClause.clauseId) continue
          const headToken = byId.get(clause.headTokenId)
          if (!headToken) continue
          const hasOwnSubject = (byHead.get(headToken.id) ?? []).some((c) => c.deprel === 'nsubj' || c.deprel === 'csubj')
          if (hasOwnSubject) continue
          if (headToken.head !== anchorId) continue // only the ambiguous anchor-attached case
          candidates += 1

          const anchorToken = byId.get(anchorId)!
          const anchorOwner = all.find((v) => (v.node.role === 'predicate' || v.node.role === 'coordinatedPredicate') && anchorToken.start >= v.node.start && anchorToken.start < v.node.end)
          if (!anchorOwner) continue
          const wronglyNestedUnderAnchor = anchorOwner.node.children.some((c) => c.start <= headToken.start && c.end >= headToken.end)
          if (wronglyNestedUnderAnchor) {
            violations += 1
            failures.push(`${split.name}/${item.id}: ambiguous modifier headed by "${headToken.text}" wrongly forced under predicate 1's own node`)
          }
        }
      }
    }

    if (failures.length > 0) console.error(`COORDINATED_PREDICATE_FALSE_SPECIFIC_SCOPE failures (${failures.length}):\n${failures.join('\n')}`)
    console.log(`COORDINATED_PREDICATE_FALSE_SPECIFIC_SCOPE audit: ${candidates} candidates; violations: ${violations}`)
    expect(violations).toBe(0)
  })
})

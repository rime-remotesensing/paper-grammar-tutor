import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { DEVELOPMENT_CASES, LOCKED_HOLDOUT_CASES } from '../../benchmark/generalization/dataset.ts'
import { BLIND_HOLDOUT_V2 } from '../../benchmark/generalization/blindHoldoutV2.ts'
import { buildClauseFrames, childrenByHead, normalizeDep, type StanzaToken } from '../../src/features/grammar/domain/stanzaSyntaxAuthority.ts'
import { buildStanzaHierarchicalTree } from '../../src/features/grammar/domain/stanzaStructureTree.ts'
import type { StructureTreeNode } from '../../src/features/grammar/domain/structureTree.ts'

/**
 * Prototype 2.6G2.5B / 2.6G2.5B2 item B6/B7 -- ClauseFrame fate audit across the full
 * 96-sentence regression corpus, INDEPENDENT of the Tree builder's own traversal (re-derives
 * clause relations directly from the frozen `buildClauseFrames`, and checks tree coverage
 * via a simple span-containment test -- never reuses buildDecomposedConstituentNode's own
 * restrictive/non-restrictive decision logic, so builder and audit cannot fail identically).
 *
 * Classifies every meaningful ClauseFrame as rendered / unexpectedly unreachable.
 * - Pre-2.6G2.5B: 20/156 unreachable (subjectless subordinate clauses discarded outright,
 *   non-restrictive relative clauses invisible to postmodifier extraction).
 * - Post-2.6G2.5B: 11/156 (subjectless-subordinate and non-restrictive-relative classes
 *   fixed; semicolon/parataxis clauses and multi-level nesting not yet addressed).
 * - Post-2.6G2.5B2: 0/156 -- recursive clause-ownership traversal (item 3, a
 *   subordinate-of-subordinate chain of arbitrary depth, plus a best-effort raw-head-chain
 *   fallback for a clause whose frozen anchorClauseHead resolution came back null),
 *   semicolon/parataxis sibling-clause discovery (item 4, reusing the exact same
 *   semicolon-gap signal collectCoordinatedPredicates already uses to EXCLUDE such a
 *   conjunct from an existing clause's own predicateHeadIds), and a generalized
 *   buried-relative-clause scan (item 5, the one remaining "interaction case": an acl:relcl
 *   attached to a bare non-restrictive appositive nested inside an nmod chain, several hops
 *   below any node this module would otherwise visit).
 *
 * This is now a strict target-zero gate (every bucket asserted `.toBe(0)`), not a ceiling.
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

function flatten(nodes: StructureTreeNode[]): StructureTreeNode[] {
  return nodes.flatMap((n) => [n, ...flatten(n.children)])
}

function hasCommaBetween(tokens: StanzaToken[], start: number, end: number): boolean {
  return tokens.some((token) => token.text === ',' && token.start >= start && token.start < end)
}

describe('Prototype 2.6G2.5B -- ClauseFrame fate audit (96-sentence corpus, independent of Tree builder internals)', () => {
  let missingArtifact = false
  for (const split of SPLITS) {
    if (!fs.existsSync(path.join(process.cwd(), 'benchmark', 'results', 'generalization', split.rawFile))) missingArtifact = true
  }

  it.skipIf(missingArtifact)('unexpectedly-unreachable ClauseFrame count never regresses past the Prototype 2.6G2.5B ceiling', () => {
    let totalClauses = 0
    let unreachableMultiLevelNesting = 0
    let unreachableOtherRelation = 0
    let unreachableRelative = 0
    let unreachableSubordinateWithSubject = 0
    let unreachableSubordinateNoSubject = 0
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
        if (!mainClause) continue

        const tree = buildStanzaHierarchicalTree(item.text, tokens)
        const flat = flatten(tree)

        for (const clause of clauses) {
          totalClauses += 1
          const head = byId.get(clause.headTokenId)!

          if (clause.relation === 'main') continue

          if (clause.relation === 'subordinate') {
            const hasSubject = (byHead.get(clause.headTokenId) ?? []).some(
              (c) => normalizeDep(c.deprel) === 'nsubj' || normalizeDep(c.deprel) === 'csubj',
            )
            const isTopLevelCandidate = clause.parentClauseId === mainClause.clauseId
            const coveredByTree = flat.some((n) => n.start <= head.start && n.end >= head.end)
            if (coveredByTree) continue
            if (!isTopLevelCandidate) {
              unreachableMultiLevelNesting += 1
            } else if (!hasSubject) {
              unreachableSubordinateNoSubject += 1
              failures.push(`${split.name}/${item.id}: subjectless subordinate "${head.text}" unreachable (regression -- item B12 should have fixed this)`)
            } else {
              unreachableSubordinateWithSubject += 1
              failures.push(`${split.name}/${item.id}: subordinate (with subject) "${head.text}" unreachable`)
            }
            continue
          }

          if (clause.relation === 'relative') {
            const parentToken = byId.get(head.head)
            const restrictive = parentToken ? !hasCommaBetween(tokens, parentToken.end, head.start) : false
            const coveredByTree = flat.some((n) => n.role === 'relativeClause' && n.start <= head.start && n.end >= head.end)
            if (coveredByTree) continue
            unreachableRelative += 1
            if (!restrictive) failures.push(`${split.name}/${item.id}: non-restrictive relative "${head.text}" unreachable (regression -- item B11 should have fixed this)`)
            else failures.push(`${split.name}/${item.id}: restrictive relative "${head.text}" unreachable`)
            continue
          }

          // 'other' -- plain acl/ccomp/csubj/parataxis clause head (includes semicolon-
          // joined independent clauses, an out-of-scope class for this phase).
          const coveredByTree = flat.some((n) => n.start <= head.start && n.end >= head.end)
          if (!coveredByTree) unreachableOtherRelation += 1
        }
      }
    }

    if (failures.length > 0) console.error(`ClauseFrame fate audit regressions (${failures.length}):\n${failures.join('\n')}`)

    console.log(
      `ClauseFrame fate audit: ${totalClauses} total clauses; unreachable -- ` +
        `subordinate/no-subject: ${unreachableSubordinateNoSubject}, ` +
        `subordinate/with-subject: ${unreachableSubordinateWithSubject}, ` +
        `relative: ${unreachableRelative}, ` +
        `multi-level nesting (known gap): ${unreachableMultiLevelNesting}, ` +
        `other-relation (known gap): ${unreachableOtherRelation}`,
    )

    // Prototype 2.6G2.5B2: every category reached the hard target (0/156) via recursive
    // clause-ownership traversal (item 3), semicolon/parataxis sibling discovery (item 4),
    // and a generalized buried-relative-clause scan (item 5, the "interaction case" --
    // acl:relcl attached to a bare non-restrictive appositive nested inside an nmod chain).
    // All five buckets are now a strict target-zero gate, not a ceiling.
    expect(unreachableSubordinateNoSubject).toBe(0)
    expect(unreachableSubordinateWithSubject).toBe(0)
    expect(unreachableRelative).toBe(0)
    expect(unreachableMultiLevelNesting).toBe(0)
    expect(unreachableOtherRelation).toBe(0)
  })
})

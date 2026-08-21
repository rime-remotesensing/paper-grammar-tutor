import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { DEVELOPMENT_CASES, LOCKED_HOLDOUT_CASES } from '../fixtures/generalization/dataset.ts'
import { BLIND_HOLDOUT_V2 } from '../fixtures/generalization/blindHoldoutV2.ts'
import { buildClauseFrames, childrenByHead, type StanzaToken } from '../../src/features/grammar/domain/stanzaSyntaxAuthority.ts'
import { buildStanzaHierarchicalTree } from '../../src/features/grammar/domain/stanzaStructureTree.ts'
import type { StructureTreeNode } from '../../src/features/grammar/domain/structureTree.ts'

/**
 * Prototype 2.6G2.6B item 4 -- independent single-owner ownership audit, deliberately NOT
 * reusing the Tree builder's own traversal logic (`buildStanzaHierarchicalTree`'s own
 * `nodesByClauseId`/`visited` bookkeeping, or the enumeration-ownership check it now applies
 * internally). Instead: re-derives, from the frozen `buildClauseFrames` output directly, (a)
 * every meaningful ClauseFrame's own head-token position, (b) its `parentClauseId`, and
 * checks the ACTUAL rendered tree via pure SOURCE-SPAN CONTAINMENT --
 *
 * - unreachable: no node in the rendered tree contains the clause's own head token at all.
 * - duplicate display owner: more than one MAXIMAL (non-nested-inside-another-match) node
 *   contains the clause's own head token -- i.e. the same clause is independently
 *   reconstructed as two or more structurally unrelated subtrees (the exact d34/enumeration-
 *   duplication bug class this phase fixes), as opposed to ordinary parent/child nesting
 *   (a clause's own predicate node sitting inside its own subject wrapper is ONE owner, not
 *   two, since one span is nested inside the other).
 * - wrong-scope display owner: some OTHER clause B's owner span strictly CONTAINS this
 *   clause's own owner span in the RENDERED tree, yet B is not a genuine ancestor of this
 *   clause per the ClauseFrame `parentClauseId` chain -- i.e. the clause is visually living
 *   inside the wrong host entirely (the d34/enumeration cross-contamination bug class). This
 *   is deliberately NOT "owner must be nested inside parent's owner": a subordinate clause
 *   anchored to the main clause is, by this Tree's own established (and intentional)
 *   architecture, placed as a flat TOP-LEVEL SIBLING of the main clause, never nested inside
 *   it -- checking for containment-or-nothing would produce false positives against that
 *   correct, by-design placement. Checking the reverse (containment implies ancestry) is the
 *   general, source-span + ClauseFrame-parentage signal that actually distinguishes "correctly
 *   scoped, however it's laid out" from "wrongly nested inside an unrelated clause's subtree".
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

/** Every node in the flattened tree whose own span contains `pos` (a single representative
 * point -- the clause's own head token start). Deliberately broad (any role at all): this
 * audit does not assume which specific role the builder chooses to represent a clause with. */
function containingNodes(flat: StructureTreeNode[], pos: number): StructureTreeNode[] {
  return flat.filter((n) => n.start <= pos && n.end > pos)
}

/** Keeps only the MAXIMAL matches -- a match strictly span-contained by another match is
 * ordinary parent/child nesting (the same owner, seen at two containment depths), not a
 * second independent owner. What survives is the set of structurally DISJOINT roots that
 * each independently claim this position -- >1 is the duplicate-ownership signal. */
function maximalOwners(matches: StructureTreeNode[]): StructureTreeNode[] {
  return matches.filter((m) => !matches.some((other) => other !== m && other.start <= m.start && other.end >= m.end))
}

describe('Prototype 2.6G2.6B -- independent single-owner display audit (96-sentence corpus, span-containment based)', () => {
  let missingArtifact = false
  for (const split of SPLITS) {
    if (!fs.existsSync(path.join(process.cwd(), 'benchmark', 'results', 'generalization', split.rawFile))) missingArtifact = true
  }

  it.skipIf(missingArtifact)('every meaningful ClauseFrame has exactly one display owner, correctly scoped', () => {
    let totalClauses = 0
    let unreachable = 0
    let duplicateOwner = 0
    let wrongScope = 0
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

        // Independently recompute each clause's own maximal owner(s) first (needed for the
        // wrong-scope parentage check below, which compares a clause's owner against its
        // OWN parent clause's owner -- both derived the same independent way).
        const ownersByClauseId = new Map<number, StructureTreeNode[]>()
        for (const clause of clauses) {
          const headToken = byId.get(clause.headTokenId)
          if (!headToken) continue
          ownersByClauseId.set(clause.clauseId, maximalOwners(containingNodes(flat, headToken.start)))
        }

        for (const clause of clauses) {
          totalClauses += 1
          const headToken = byId.get(clause.headTokenId)
          if (!headToken) continue
          const owners = ownersByClauseId.get(clause.clauseId) ?? []

          if (owners.length === 0) {
            unreachable += 1
            failures.push(`${split.name}/${item.id}: clause "${headToken.text}" unreachable`)
            continue
          }
          if (owners.length > 1) {
            duplicateOwner += 1
            failures.push(`${split.name}/${item.id}: clause "${headToken.text}" has ${owners.length} independent display owners`)
            continue
          }

        }

        // Wrong-scope check, second pass (needs every clause's owner already resolved
        // above): for every pair (A, B), if B's owner span strictly CONTAINS A's owner span
        // in the rendered tree, B must be a genuine ancestor of A per the ClauseFrame
        // `parentClauseId` chain -- otherwise A is visually living inside an unrelated
        // clause's subtree (cross-contamination), independent of how "deep" that nesting is
        // laid out for any individual clause (which, by this Tree's own design, varies --
        // some subordinates nest, some sit as flat top-level siblings; both are "correct
        // scope" as long as nothing is contained by the WRONG host).
        const isAncestor = (candidateAncestorId: number, clauseId: number): boolean => {
          let current = clauses.find((c) => c.clauseId === clauseId)
          let guard = 0
          while (current && current.parentClauseId !== null && guard < 64) {
            if (current.parentClauseId === candidateAncestorId) return true
            current = clauses.find((c) => c.clauseId === current!.parentClauseId)
            guard += 1
          }
          return false
        }
        for (const clauseA of clauses) {
          const ownersA = ownersByClauseId.get(clauseA.clauseId) ?? []
          if (ownersA.length !== 1) continue // unreachable/duplicate already reported above
          const ownerA = ownersA[0]!
          for (const clauseB of clauses) {
            if (clauseB.clauseId === clauseA.clauseId) continue
            const ownersB = ownersByClauseId.get(clauseB.clauseId) ?? []
            if (ownersB.length !== 1) continue
            const ownerB = ownersB[0]!
            const strictlyContains = ownerB.start <= ownerA.start && ownerB.end >= ownerA.end && ownerB !== ownerA && !(ownerB.start === ownerA.start && ownerB.end === ownerA.end)
            if (!strictlyContains) continue
            if (!isAncestor(clauseB.clauseId, clauseA.clauseId)) {
              wrongScope += 1
              const headA = byId.get(clauseA.headTokenId)
              const headB = byId.get(clauseB.headTokenId)
              failures.push(`${split.name}/${item.id}: clause "${headA?.text}" is contained inside unrelated clause "${headB?.text}"'s owner`)
            }
          }
        }
      }
    }

    if (failures.length > 0) console.error(`Single-owner audit failures (${failures.length}):\n${failures.slice(0, 50).join('\n')}`)

    console.log(
      `Single-owner audit: ${totalClauses} total clauses; unreachable: ${unreachable}, ` +
        `duplicate display owner: ${duplicateOwner}, wrong-scope owner: ${wrongScope}`,
    )

    expect(unreachable).toBe(0)
    expect(duplicateOwner).toBe(0)
    expect(wrongScope).toBe(0)
  })
})

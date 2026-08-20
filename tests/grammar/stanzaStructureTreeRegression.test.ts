import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { DEVELOPMENT_CASES, LOCKED_HOLDOUT_CASES } from '../../benchmark/generalization/dataset.ts'
import { BLIND_HOLDOUT_V2 } from '../../benchmark/generalization/blindHoldoutV2.ts'
import { buildSentenceCoreSetFromStanzaTokens, type StanzaToken } from '../../src/features/grammar/domain/stanzaSyntaxAuthority.ts'
import { buildStanzaHierarchicalTree } from '../../src/features/grammar/domain/stanzaStructureTree.ts'
import type { StructureTreeNode } from '../../src/features/grammar/domain/structureTree.ts'

/**
 * Prototype 2.6G2 -- section 22/27 hard-gate regression over the full 96-sentence frozen
 * corpus (development 48 + former holdout 24 + BLIND_HOLDOUT_V2 24). This checks the NEW
 * Tree builder for INTERNAL consistency against the already-frozen canonical SentenceCoreSet
 * computed from the SAME tokens (never against hand gold) -- i.e. "does the Tree agree with
 * the authority it was built from", not "is the Tree linguistically perfect". Uses only the
 * already-saved raw Stanza artifacts; no new Stanza inference, no gold re-tuning.
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

function hasLexicalLoss(text: string, nodes: StructureTreeNode[]): boolean {
  return flatten(nodes).some((n) => text.slice(n.start, n.end) !== n.text)
}

function hasVisibleDuplicate(nodes: StructureTreeNode[]): boolean {
  const keys = flatten(nodes).map((n) => `${n.role}:${n.start}:${n.end}:${n.text}`)
  return new Set(keys).size !== keys.length
}

function findNodesWithRole(nodes: StructureTreeNode[], role: string): StructureTreeNode[] {
  return flatten(nodes).filter((n) => n.role === role)
}

describe('Prototype 2.6G2 Structure Tree hard gates (96-sentence regression corpus)', () => {
  let missingArtifact = false
  for (const split of SPLITS) {
    if (!fs.existsSync(path.join(process.cwd(), 'benchmark', 'results', 'generalization', split.rawFile))) missingArtifact = true
  }

  it.skipIf(missingArtifact)('satisfies every section 27 hard gate across all 96 cases', () => {
    let total = 0
    let lexicalLossCount = 0
    let visibleDuplicateCount = 0
    let predicateMissingCount = 0
    let predicateDuplicatedCount = 0
    let ocContradictionCount = 0
    let subordinateLeakageCount = 0
    const failures: string[] = []

    for (const split of SPLITS) {
      const raw = loadRaw(split.rawFile)
      for (const item of split.cases) {
        const parsed = raw.find((entry) => entry.id === item.id)
        if (!parsed) continue
        total += 1

        const { coreSet } = buildSentenceCoreSetFromStanzaTokens(item.text, parsed.tokens)
        const tree = buildStanzaHierarchicalTree(item.text, parsed.tokens)

        if (coreSet.predicateCores.length === 0) continue // no main clause found -- nothing to check structurally

        if (hasLexicalLoss(item.text, tree)) {
          lexicalLossCount += 1
          failures.push(`${split.name}/${item.id}: lexical loss`)
        }
        if (hasVisibleDuplicate(tree)) {
          visibleDuplicateCount += 1
          failures.push(`${split.name}/${item.id}: visible duplicate`)
        }

        // Every canonical predicate verb must appear as exactly one predicate/coordinatedPredicate
        // node somewhere in the tree, at the exact canonical span.
        const predicateNodes = [...findNodesWithRole(tree, 'predicate'), ...findNodesWithRole(tree, 'coordinatedPredicate')]
        for (const core of coreSet.predicateCores) {
          if (!core.verb) continue
          const matches = predicateNodes.filter((n) => n.start === core.verb!.start && n.end === core.verb!.end)
          if (matches.length === 0) {
            predicateMissingCount += 1
            failures.push(`${split.name}/${item.id}: predicate "${core.verb.text}" missing from tree`)
          } else if (matches.length > 1) {
            predicateDuplicatedCount += 1
            failures.push(`${split.name}/${item.id}: predicate "${core.verb.text}" duplicated in tree`)
          }
        }

        // O/C contradiction: canonical object/complement spans must appear as object/complement
        // role nodes; nothing else should claim the object/complement role at a different span
        // for the SAME predicate's own direct slot children.
        const objectNodes = findNodesWithRole(tree, 'object')
        const complementNodes = findNodesWithRole(tree, 'complement')
        for (const core of coreSet.predicateCores) {
          if (core.object && !objectNodes.some((n) => n.start === core.object!.start && n.end === core.object!.end)) {
            ocContradictionCount += 1
            failures.push(`${split.name}/${item.id}: canonical object "${core.object.text}" not represented as an object node`)
          }
          // Prototype 2.6G2.6: the Tree layer's own independent complement decomposition now
          // carries the same island-restriction general fix as canonical authority grounding
          // (see `contiguousIslandContaining` in stanzaStructureTree.ts) -- the
          // `development/d15-svc-svc-coordination` exception this gate previously needed
          // (2.6G2.5C/C2 fixed canonical grounding but left the Tree's own separate builder
          // untouched, by design, since Tree was out of scope in that phase) is resolved and
          // removed; this is now a strict zero gate again for every case.
          if (core.complement && !complementNodes.some((n) => n.start === core.complement!.start && n.end === core.complement!.end)) {
            ocContradictionCount += 1
            failures.push(`${split.name}/${item.id}: canonical complement "${core.complement.text}" not represented as a complement node`)
          }
        }

        // Subordinate predicate leakage: no main-clause predicate/object/complement span may
        // fall inside a sibling subordinate-clause subtree, and vice versa.
        const topLevel = tree
        if (topLevel.length > 1) {
          const mainIdx = topLevel.findIndex((n) => n.role === 'subject' && coreSet.subject && n.start === coreSet.subject.start)
          if (mainIdx >= 0) {
            const mainSpan = topLevel[mainIdx]!
            for (let i = 0; i < topLevel.length; i++) {
              if (i === mainIdx) continue
              const other = topLevel[i]!
              const overlap = Math.max(mainSpan.start, other.start) < Math.min(mainSpan.end, other.end)
              if (overlap) {
                subordinateLeakageCount += 1
                failures.push(`${split.name}/${item.id}: subordinate/main clause span overlap`)
              }
            }
          }
        }
      }
    }

    if (failures.length > 0) {
      console.error(`Tree regression failures (${failures.length}):\n${failures.slice(0, 50).join('\n')}`)
    }

    expect(total).toBe(96)
    expect(lexicalLossCount).toBe(0)
    expect(visibleDuplicateCount).toBe(0)
    expect(predicateMissingCount).toBe(0)
    expect(predicateDuplicatedCount).toBe(0)
    expect(ocContradictionCount).toBe(0)
    expect(subordinateLeakageCount).toBe(0)
  })
})
